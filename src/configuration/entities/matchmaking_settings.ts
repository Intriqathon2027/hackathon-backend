import {
  IsBoolean,
  IsInt,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
} from "class-validator";
import { Type } from "class-transformer";

export class Constraint {
  @IsString()
  rule: "MIN" | "MAX" | "EQUAL";

  @IsArray()
  @IsString({ each: true })
  schools: string[];

  @IsInt()
  value: number;

  @IsBoolean()
  multiple: boolean;
}

export class MatchmakingSettings {
  @IsBoolean()
  isActive: boolean;

  @IsInt()
  teamSizeMin: number;

  @IsInt()
  teamSizeMax: number;

  @IsOptional()
  @IsInt()
  maxTeamsPerSubject?: number;

  @IsOptional()
  @IsInt()
  maxTeamsPerTopic?: number;

  @IsOptional()
  @IsString()
  algorithm?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Constraint)
  constraints: Constraint[];
}
