import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService, DiscordApiUser, GithubApiUser } from "./auth.service";
import { Public } from "src/common/decorators/public.decorator";
import { DiscordUser } from "passport-discord-auth";

// Type pour le `state` encodé en JSON dans l’OAuth
interface DecodedState {
  userId: string;
  supabaseUserId: string;
  organizerPlatform: boolean;
}

type Provider = "discord" | "github";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // -----------------------------
  // DISCORD CALLBACK
  // -----------------------------
  @Get("discord/callback")
  @Public()
  async discordCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    await this.handleOAuthCallback<DiscordApiUser>({
      provider: "discord",
      code,
      state,
      error,
      res,
      getUser: (c) => this.authService.getDiscordUser(c),
      updateUser: (decoded, user) =>
        this.authService.updateUserWithDiscord(
          decoded.userId,
          decoded.supabaseUserId,
          user as DiscordUser,
        ),
    });
  }

  // -----------------------------
  // GITHUB CALLBACK
  // -----------------------------
  @Get("github/callback")
  @Public()
  async githubCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Res() res: Response,
  ) {
    await this.handleOAuthCallback<GithubApiUser>({
      provider: "github",
      code,
      state,
      error,
      res,
      getUser: (c) => this.authService.getGithubUser(c),
      updateUser: (decoded, user) =>
        this.authService.updateUserWithGithub(
          decoded.userId,
          decoded.supabaseUserId,
          user,
        ),
    });
  }

  // -----------------------------
  // UNLINK DISCORD
  // -----------------------------
  @Delete("discord/:userId")
  async unlinkDiscord(
    @Param("userId") userId: string,
    @Req()
    req: Request & {
      user?: { id?: string; sub?: string; supabaseUserId?: string };
    },
  ): Promise<void> {
    const supabaseUserId =
      req.user?.supabaseUserId ?? req.user?.id ?? req.user?.sub ?? "";
    await this.authService.unlinkDiscord(userId, supabaseUserId);
  }

  // -----------------------------
  // UNLINK GITHUB
  // -----------------------------
  @Delete("github/:userId")
  async unlinkGithub(
    @Param("userId") userId: string,
    @Req()
    req: Request & {
      user?: { id?: string; sub?: string; supabaseUserId?: string };
    },
  ): Promise<void> {
    const supabaseUserId =
      req.user?.supabaseUserId ?? req.user?.id ?? req.user?.sub ?? "";
    await this.authService.unlinkGithub(userId, supabaseUserId);
  }

  // -----------------------------
  // Generic OAuth callback handler
  // -----------------------------
  private async handleOAuthCallback<TUser>({
    provider,
    code,
    state,
    error,
    res,
    getUser,
    updateUser,
  }: {
    provider: Provider;
    code: string;
    state: string;
    error: string;
    res: Response;
    getUser: (code: string) => Promise<TUser>;
    updateUser: (decoded: DecodedState, user: TUser) => Promise<void>;
  }): Promise<void> {
    let decoded: DecodedState | null = null;

    if (state) {
      try {
        decoded = JSON.parse(decodeURIComponent(state)) as DecodedState;
      } catch (e) {
        console.warn(`Failed to decode state for ${provider}:`, e);
      }
    }

    if (error === "access_denied") {
      res.redirect(
        this.getRedirectUri(
          decoded?.organizerPlatform ?? false,
          `${provider}_cancelled`,
        ),
      );
      return;
    }

    if (!code || !decoded) {
      res.status(400).send(`Missing code or invalid state for ${provider}`);
      return;
    }

    try {
      const user = await getUser(code);
      await updateUser(decoded, user);

      res.redirect(this.getRedirectUri(decoded.organizerPlatform));
      return;
    } catch (err) {
      console.error(`${provider} OAuth2 flow failed:`, err);
      res.redirect(
        this.getRedirectUri(
          decoded?.organizerPlatform ?? false,
          `${provider}_error`,
        ),
      );
      return;
    }
  }

  private getRedirectUri(organizerPlatform: boolean, error?: string): string {
    const base = organizerPlatform
      ? process.env.BASE_URL + "/organizer/profile"
      : process.env.BASE_URL + "/user/profile";

    return error ? `${base}?error=${error}` : base;
  }
}
