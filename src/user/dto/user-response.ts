import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { JsonType } from "src/configuration/dto/configuration-response";

export class UserResponse {
  @ApiProperty({
    description: "Unique identifier for the user",
    example: "123e4567-e89b-12d3-a456-426614174000",
    format: "uuid",
  })
  id: string;

  @ApiProperty({
    description: "Supabase user ID",
    example: "76a54a08-282a-4aeb-900c-739ed2e413ca",
  })
  supabaseUserId: string;

  @ApiProperty({
    description: "Firstname of the user",
    example: "John",
  })
  firstname: string;

  @ApiProperty({
    description: "Lastname of the user",
    example: "Doe",
  })
  lastname: string;

  @ApiProperty({
    description: "Email of the user",
    example: "john.doe@example.com",
  })
  email: string;

  @ApiProperty({
    description: "Date when the user was created",
    example: "2023-10-01T12:00:00Z",
    type: String,
    format: "date-time",
  })
  createdAt: Date;

  @ApiProperty({
    description: "Role of the user",
    example: "PARTICIPANT",
    enum: Role,
  })
  role: Role;

  @ApiProperty({
    description: "School of the user",
    example: "Harvard University",
  })
  school: string | null;

  @ApiProperty({
    description: "Short biography of the user",
    example: "Passionate software engineer with 5 years of experience.",
    nullable: true,
  })
  bio?: string | null;

  @ApiProperty({
    description: "List of user interests",
    example: ["Python", "Design", "Gaming"],
    type: [String],
    nullable: true,
  })
  interests?: string[] | null;

  @ApiProperty({
    description: "LinkedIn profile URL or username",
    example: "https://www.linkedin.com/in/johndoe",
    nullable: true,
  })
  linkedin?: string | null;

  @ApiProperty({
    description: "GitHub profile URL or username",
    example: "https://github.com/johndoe",
    nullable: true,
  })
  github?: JsonType | null;

  @ApiProperty({
    description: "Discord identifier",
    example: "johndoe#1234",
    nullable: true,
  })
  discord?: JsonType | null;

  @ApiProperty({
    description: "Profile picture Path",
    example: "photo.jpg, picture.png",
    nullable: true,
  })
  profilePicturePath?: string | null;

  @ApiProperty({
    description: "Indicates if the invitation email has been sent",
    example: false,
  })
  invitationSent: boolean;

  @ApiProperty({
    description:
      "Every available subject id, ordered by decreasing preference (the first one is the favorite subject)",
    example: [
      "123e4567-e89b-12d3-a456-426614174000",
      "223e4567-e89b-12d3-a456-426614174001",
    ],
    type: [String],
  })
  favoriteSubjectIds?: string[];
}
