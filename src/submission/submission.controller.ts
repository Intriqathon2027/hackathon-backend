import { Controller, Post, Get, Body, Put, Param } from "@nestjs/common";
import { SubmissionService } from "./submission.service";
import { UpdateSubmissionDto } from "./dto/update-submission.dto";
import { EvaluateSubmissionDto } from "./dto/evaluate-submission.dto";
import { submissionReponseDto } from "./dto/submission-reponse.dto";
import { SupabaseDecodedUser } from "src/common/decorators/supabase-decoded-user.types";
import { SupabaseUser } from "src/common/decorators/supabase-user.decorator";
import { SubmissionDetailedResponseDto } from "./dto/submission-detailed-reponse.dto";
import { CommentSubmissionDto } from "./dto/comment-submission.dto";
import { Roles } from "src/common/decorators/roles.decorator";
import { Role } from "@prisma/client";

@Controller("submission")
export class SubmissionController {
  constructor(private readonly submissionService: SubmissionService) { }

  @Post()
  @Roles(Role.ORGANIZER)
  async create(@Param("teamId") teamId: string): Promise<submissionReponseDto> {
    return this.submissionService.createSubmission(teamId);
  }

  @Post("createAll")
  @Roles(Role.ORGANIZER)
  async createAll(): Promise<submissionReponseDto[]> {
    return this.submissionService.createAllSubmissions();
  }

  @Get()
  @Roles(Role.ORGANIZER, Role.JURY, Role.MENTOR)
  async findAll(): Promise<SubmissionDetailedResponseDto[]> {
    return this.submissionService.getAllSubmissions();
  }

  @Get("due-date")
  async getDueDate(): Promise<Date> {
    return this.submissionService.getDueDate();
  }

  @Get(":teamId")
  async find(
    @Param("teamId") teamId: string,
  ): Promise<SubmissionDetailedResponseDto> {
    return this.submissionService.getSubmissions(teamId);
  }

  @Put()
  async update(
    @Body() submission: UpdateSubmissionDto,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ): Promise<submissionReponseDto> {
    return this.submissionService.updateSubmission(submission, supabaseUser.sub);
  }

  @Post("evaluate")
  @Roles(Role.JURY)
  async evaluate(
    @Body() evaluation: EvaluateSubmissionDto,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ): Promise<submissionReponseDto> {
    return this.submissionService.evaluateSubmission(
      evaluation,
      supabaseUser.sub,
    );
  }

  @Post("comment")
  @Roles(Role.MENTOR)
  async comment(
    @Body() comment: CommentSubmissionDto,
    @SupabaseUser() supabaseUser: SupabaseDecodedUser,
  ): Promise<submissionReponseDto> {
    return this.submissionService.commentSubmission(comment, supabaseUser.sub);
  }
}
