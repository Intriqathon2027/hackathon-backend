import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { JsonType } from "src/configuration/dto/configuration-response";

export class CreateUserDto {
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
    description: "Role of the user",
    example: "PARTICIPANT",
    required: true,
  })
  role: Role;

  @ApiProperty({
    description: "School of the user",
    example: "Harvard University",
    required: false,
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
  interests?: string[];

  @ApiProperty({
    description: "LinkedIn profile URL or username",
    example: "https://www.linkedin.com/in/johndoe",
    nullable: true,
  })
  linkedin?: string | null;

  @ApiProperty({
    description: "GitHub social account",
    example: { id: "123456", username: "johndoe" },
    nullable: true,
  })
  github?: JsonType | null;

  @ApiProperty({
    description: "Discord social account",
    example: { id: "123456", username: "johndoe#1234" },
    nullable: true,
  })
  discord?: JsonType | null;

  @ApiProperty({
    description: "Profile picture URL",
    example: "https://example.com/profile-pic.jpg",
    nullable: true,
  })
  profilePicturePath?: string | null;

  @ApiProperty({
    description:
      "Every available subject id, ordered by decreasing preference (the first one is the favorite subject)",
    example: [
      "123e4567-e89b-12d3-a456-426614174000",
      "223e4567-e89b-12d3-a456-426614174001",
    ],
    type: [String],
    nullable: true,
  })
  favoriteSubjectIds?: string[];
}
