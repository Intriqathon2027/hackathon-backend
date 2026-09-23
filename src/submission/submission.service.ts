import {
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from "@nestjs/common";
import { HackathonConfigKey, SubmissionStatus } from "@prisma/client";
import { PrismaService } from "src/prisma/prisma.service";
import { UpdateSubmissionDto } from "./dto/update-submission.dto";
import { EvaluateSubmissionDto } from "./dto/evaluate-submission.dto";
import { CommentSubmissionDto } from "./dto/comment-submission.dto";
import {
  PhaseSettings,
  Phase,
} from "src/configuration/entities/phase_settings";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

@Injectable()
export class SubmissionService {
  constructor(private readonly prisma: PrismaService) { }

  async createSubmission(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });

    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    const submission = await this.prisma.submission.findUnique({
      where: { teamId },
    });

    if (submission) {
      throw new PreconditionFailedException(
        `Submission for teamId ${teamId} already exists`,
      );
    }

    return this.prisma.submission.create({
      data: {
        teamId,
        grade: null,
        status: SubmissionStatus.NOT_SUBMITTED,
        submissionFilePath: null,
      },
    });
  }

  async createAllSubmissions() {
    const teams = await this.prisma.team.findMany();
    const submissions = await Promise.all(
      teams.map((team) => this.createSubmission(team.id)),
    );
    return submissions;
  }

  async getSubmissions(teamId: string) {
    let submission = await this.prisma.submission.findUnique({
      where: { teamId },
      include: {
        evaluations: true,
        comments: true,
      },
    });

    if (!submission) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new NotFoundException(`Team with id ${teamId} not found`);
      }
      submission = await this.prisma.submission.create({
        data: {
          teamId,
          grade: null,
          status: SubmissionStatus.NOT_SUBMITTED,
          submissionFilePath: null,
        },
        include: {
          evaluations: true,
          comments: true,
        },
      });
    }

    return submission;
  }

  async getAllSubmissions() {
    return this.prisma.submission.findMany({
      include: {
        evaluations: true,
        comments: true,
      },
    });
  }

  async getDueDate(): Promise<Date> {
    const hackathonConfig = await this.prisma.hackathonConfig.findFirst({
      where: { key: HackathonConfigKey.PHASES },
    });


    if (!hackathonConfig) {
      throw new NotFoundException("Hackathon configuration not found");
    }

    let rawValue: unknown = hackathonConfig.value;
    if (typeof rawValue === "string") {
      try {
        rawValue = JSON.parse(rawValue);
      } catch {
        throw new PreconditionFailedException(
          "Invalid JSON format for hackathonConfig.value",
        );
      }
    }

    let normalizedValue: { phases: unknown };
    if (
      typeof rawValue === "object" &&
      rawValue !== null &&
      "phases" in (rawValue as Record<string, unknown>)
    ) {
      const maybePhases = (rawValue as Record<string, unknown>).phases;
      normalizedValue = { phases: maybePhases };
    } else if (Array.isArray(rawValue)) {
      normalizedValue = { phases: rawValue };
    } else {
      throw new PreconditionFailedException(
        "Invalid format for hackathonConfig.value",
      );
    }

    const phaseSettings = plainToInstance(PhaseSettings, normalizedValue);
    const errors = validateSync(phaseSettings);
    if (errors.length > 0) {
      throw new PreconditionFailedException(
        "Invalid PhaseSettings format: " + JSON.stringify(errors),
      );
    }

    const codingPhase = phaseSettings.phases.find((p: Phase) => p.order === 4);
    if (!codingPhase?.endDate) {
      throw new NotFoundException("Coding phase endDate not found");
    }

    return new Date(codingPhase.endDate);
  }

  async updateSubmission(submission: UpdateSubmissionDto, supabaseUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user) {
      throw new NotFoundException(
        `User with supabaseUserId ${supabaseUserId} not found`,
      );
    }

    if (user.teamId !== submission.teamId) {
      throw new PreconditionFailedException("You are not in this team");
    }

    const dueDate = await this.getDueDate();
    if (new Date() > dueDate) {
      throw new PreconditionFailedException("Submission update is not allowed after the due date");
    }

    return this.prisma.submission.update({
      where: { teamId: submission.teamId },
      data: {
        submissionFilePath: submission.submissionFilePath,
        status: SubmissionStatus.PENDING,
      },
    });
  }

  async evaluateSubmission(
    evaluation: EvaluateSubmissionDto,
    supabaseJuryId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId: supabaseJuryId },
    });

    if (!user) {
      throw new NotFoundException(
        `Jury with supabaseUserId ${supabaseJuryId} not found`,
      );
    }

    const juryId = user.id;

    await this.prisma.evaluation.create({
      data: {
        juryId,
        submissionId: evaluation.submissionId,
        grade: evaluation.grade,
        comment: evaluation.comment,
        evaluationFilePath: evaluation.evaluationFilePath,
      },
    });

    const all_evaluations = await this.prisma.evaluation.findMany({
      where: { submissionId: evaluation.submissionId },
    });

    const total_grade = all_evaluations.reduce(
      (sum, evalItem) => sum + evalItem.grade,
      0,
    );

    const average_grade = Math.round(total_grade / all_evaluations.length);

    return this.prisma.submission.update({
      where: { id: evaluation.submissionId },
      data: {
        grade: average_grade,
        status: SubmissionStatus.GRADED,
      },
    });
  }

  async commentSubmission(
    comment: CommentSubmissionDto,
    supabaseUserId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { supabaseUserId },
    });

    if (!user) {
      throw new NotFoundException(
        `User with supabaseUserId ${supabaseUserId} not found`,
      );
    }

    const userId = user.id;

    await this.prisma.comment.create({
      data: {
        submissionId: comment.submissionId,
        mentorId: userId,
        content: comment.content,
      },
    });

    const submission = await this.prisma.submission.findFirst({
      where: { id: comment.submissionId },
    });

    if (!submission) {
      throw new NotFoundException(
        `Submission with id ${comment.submissionId} not found`,
      );
    }

    return submission;
  }
}
