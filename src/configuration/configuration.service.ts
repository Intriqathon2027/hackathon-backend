import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateConfigurationDTO } from "./dto/update-configuration.dto";
import { CreateConfigurationDTO } from "./dto/create-configuration.dto";
import { ConfigurationResponse } from "./dto/configuration-response";
import { Role, HackathonConfigKey } from "@prisma/client";
import { PhaseSettings } from "./entities/phase_settings";
import { LegalSettings } from "./entities/legal_settings";
import { TextsSettings } from "./entities/texts_settings";
import { MediaSettings } from "./entities/media_settings";
import { ThemesSettings } from "./entities/themes_settings";
import { PartnersSettings } from "./entities/partner_settings";
import { MatchmakingSettings } from "./entities/matchmaking_settings";
import { plainToInstance } from "class-transformer";
import { validateOrReject } from "class-validator";
import { MailingSettings } from "./entities/mail_settings";
import { PublicConfigurationKey } from "./enums/configuration-key.enum";
import { DEFAULT_HACKATHON_PHASES } from "./constants/default-phases.constant";

type ConfigSchemaClass<T = unknown> = new (...args: any[]) => T;

@Injectable()
export class ConfigurationService {
  private configSchemas: Record<HackathonConfigKey, ConfigSchemaClass> = {
    PHASES: PhaseSettings,
    LEGAL: LegalSettings,
    TEXTS: TextsSettings,
    MEDIA: MediaSettings,
    THEMES: ThemesSettings,
    PARTNERS: PartnersSettings,
    MATCHMAKING: MatchmakingSettings,
    MAILING: MailingSettings,
  };

  constructor(private readonly prisma: PrismaService) {}

  private async validateConfiguration(
    key: HackathonConfigKey,
    value: unknown,
  ): Promise<void> {
    const schema = this.configSchemas[key];
    if (!schema) {
      throw new BadRequestException(
        `No validation schema defined for key '${key}'`,
      );
    }

    try {
      if (Array.isArray(value)) {
        const instances = value.map((item) => plainToInstance(schema, item));
        for (const instance of instances) {
          await validateOrReject(instance as object, {
            whitelist: true,
            forbidNonWhitelisted: true,
          });
        }
      } else {
        const instance = plainToInstance(schema, value);
        await validateOrReject(instance as object, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
      }
    } catch (errors) {
      throw new BadRequestException(
        `Validation failed for key '${key}': ${JSON.stringify(errors)}`,
      );
    }
  }

  async create(
    newConfigurationData: CreateConfigurationDTO,
    supabaseUserId: string,
  ): Promise<ConfigurationResponse> {
    await this.validateUserRole(supabaseUserId);

    const existingConfig = await this.prisma.hackathonConfig.findUnique({
      where: { key: newConfigurationData.key },
    });
    if (existingConfig) {
      throw new Error(
        `Configuration with key '${newConfigurationData.key}' already exists.`,
      );
    }

    await this.validateConfiguration(
      newConfigurationData.key,
      newConfigurationData.value,
    );
    return this.prisma.hackathonConfig.create({
      data: {
        key: newConfigurationData.key,
        value: newConfigurationData.value,
      },
    });
  }

  async update(
    key: HackathonConfigKey,
    updateConfigurationData: UpdateConfigurationDTO,
    supabaseUserId: string,
  ): Promise<ConfigurationResponse> {
    await this.validateUserRole(supabaseUserId);

    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key },
    });
    if (!config)
      throw new NotFoundException(`Configuration with key '${key}' not found`);

    await this.validateConfiguration(key, updateConfigurationData.value);

    return this.prisma.hackathonConfig.update({
      where: { key },
      data: { value: updateConfigurationData.value, updatedAt: new Date() },
    });
  }

  async findOne(key: HackathonConfigKey): Promise<ConfigurationResponse> {
    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key },
    });
    if (!config)
      throw new NotFoundException(`Configuration with key '${key}' not found`);
    return config;
  }

  async findOnePublic(
    key: PublicConfigurationKey,
  ): Promise<ConfigurationResponse> {
    const config = await this.prisma.hackathonConfig.findUnique({
      where: { key },
    });
    if (!config)
      throw new NotFoundException(`Configuration with key '${key}' not found`);
    return config;
  }

  private async validateUserRole(supabaseUserId: string) {
    const existUser = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });
    if (!existUser) {
      throw new NotFoundException("User not found.");
    }
    if (existUser?.role !== Role.ORGANIZER) {
      throw new ForbiddenException("Only organizer can create FAQs.");
    }
  }

  /* ------ HACKATHON PHASES MANAGEMENT ------ */

  /**
   * Fetches and validates the current phase settings.
   * @returns {Promise<PhaseSettings>} The validated phase settings.
   * @throws {NotFoundException} If the phases configuration is not found.
   * @throws {BadRequestException} If the phases configuration data is corrupt or invalid.
   */
  private async getValidatedPhaseSettings(): Promise<PhaseSettings> {
    const phasesConfig = await this.prisma.hackathonConfig.findUnique({
      where: { key: HackathonConfigKey.PHASES },
    });

    if (!phasesConfig) {
      throw new NotFoundException("Phases configuration not found.");
    }

    const rawPhaseData = phasesConfig.value;
    const phasesSettingsInstance = plainToInstance(
      PhaseSettings,
      rawPhaseData as object,
    );

    try {
      await validateOrReject(phasesSettingsInstance);
    } catch (errors) {
      throw new BadRequestException(
        "Phases configuration data is corrupt or invalid: " +
          JSON.stringify(errors),
      );
    }

    return phasesSettingsInstance;
  }

  async skipPhase(supabaseUserId: string) {
    await this.validateUserRole(supabaseUserId);
    const phases = await this.getValidatedPhaseSettings();

    const inProgressPhase = phases.phases.find(
      (phase) => phase.status === "IN_PROGRESS",
    );
    if (inProgressPhase) {
      throw new BadRequestException(
        "Cannot skip phase while another phase is in progress.",
      );
    }

    const pendingPhaseIndex = phases.phases.findIndex(
      (phase) => phase.status === "PENDING",
    );
    if (pendingPhaseIndex === -1) {
      throw new BadRequestException("No pending phase to skip.");
    }

    const pendingPhase = phases.phases[pendingPhaseIndex];
    if (!pendingPhase.optionalPhase) {
      throw new BadRequestException("Cannot skip a non-optional phase.");
    }

    phases.phases[pendingPhaseIndex].status = "SKIPPED";
    phases.phases[pendingPhaseIndex].startDate = new Date().toISOString();
    phases.phases[pendingPhaseIndex].endDate = new Date().toISOString();

    if (pendingPhaseIndex + 1 < phases.phases.length) {
      phases.phases[pendingPhaseIndex + 1].status = "PENDING";
    }

    await this.update(
      HackathonConfigKey.PHASES,
      { value: phases },
      supabaseUserId,
    );
  }

  async beginNextPhase(supabaseUserId: string) {
    await this.validateUserRole(supabaseUserId);
    const phases = await this.getValidatedPhaseSettings();

    const inProgressPhase = phases.phases.find(
      (phase) => phase.status === "IN_PROGRESS",
    );
    if (inProgressPhase) {
      throw new BadRequestException(
        "Cannot begin a new phase while another phase is in progress.",
      );
    }

    const pendingPhaseIndex = phases.phases.findIndex(
      (phase) => phase.status === "PENDING",
    );
    if (pendingPhaseIndex === -1) {
      throw new BadRequestException("No pending phase to begin.");
    }

    phases.phases[pendingPhaseIndex].status = "IN_PROGRESS";
    phases.phases[pendingPhaseIndex].startDate = new Date().toISOString();

    await this.update(
      HackathonConfigKey.PHASES,
      { value: phases },
      supabaseUserId,
    );
  }

  async completeCurrentPhase(supabaseUserId: string) {
    await this.validateUserRole(supabaseUserId);
    const phases = await this.getValidatedPhaseSettings();

    const inProgressPhaseIndex = phases.phases.findIndex(
      (phase) => phase.status === "IN_PROGRESS",
    );
    if (inProgressPhaseIndex === -1) {
      throw new BadRequestException("No phase is currently in progress.");
    }

    phases.phases[inProgressPhaseIndex].status = "COMPLETED";
    phases.phases[inProgressPhaseIndex].endDate = new Date().toISOString();

    // Update the next phase to PENDING if it exists
    if (inProgressPhaseIndex + 1 < phases.phases.length) {
      phases.phases[inProgressPhaseIndex + 1].status = "PENDING";
    }

    await this.update(
      HackathonConfigKey.PHASES,
      { value: phases },
      supabaseUserId,
    );
  }

  async resetPhases(supabaseUserId: string) {
    await this.validateUserRole(supabaseUserId);

    const currentSettings = await this.getValidatedPhaseSettings();

    const resetPhases = DEFAULT_HACKATHON_PHASES.map((defaultPhase) => {
      const existing = currentSettings.phases.find(
        (p) => p.order === defaultPhase.order,
      );
      const name =
        existing?.name && !existing.name.startsWith("Phase ")
          ? existing.name
          : defaultPhase.name;
      const endDate =
        defaultPhase.order === 4 && existing?.endDate
          ? existing.endDate
          : defaultPhase.endDate;

      return {
        ...defaultPhase,
        name,
        endDate,
      };
    });

    return this.update(
      HackathonConfigKey.PHASES,
      { value: { phases: resetPhases } },
      supabaseUserId,
    );
  }
}
