import { ApiProperty } from "@nestjs/swagger";
import {
  IsInt,
  IsOptional,
  Min,
  IsBoolean,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { Constraint } from "src/configuration/entities/matchmaking_settings";

export class AutogenerateUserBasedDTO {
  @ApiProperty({
    description: "Minimum size of a team",
    example: 3,
    required: false,
    default: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamSizeMin?: number;

  @ApiProperty({
    description: "Maximum size of a team",
    example: 5,
    required: false,
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  teamSizeMax?: number;

  @ApiProperty({
    description: "Maximum number of teams that can be assigned to a single subject",
    example: 2,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTeamsPerSubject?: number;

  @ApiProperty({
    description: "Ignore school constraints if true",
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  ignoreConstraints?: boolean;

  @ApiProperty({
    description: "Optional custom school constraints override",
    type: [Constraint],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Constraint)
  constraints?: Constraint[];
}
