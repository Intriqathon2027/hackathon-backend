import { Theme } from "../entities/theme-subject.entity";
import { ThemesSettings } from "../entities/themes_settings";

/**
 * Extracts the themes out of the raw value stored in the THEMES configuration.
 */
export function parseThemesSettings(value: unknown): Theme[] {
  if (!value || typeof value !== "object" || !("themes" in value)) return [];
  const settings = value as ThemesSettings;
  return settings.themes ?? [];
}

/**
 * Flattens the themes into the list of every available subject id.
 */
export function getAllSubjectIds(themes: Theme[]): string[] {
  return themes.flatMap((theme) => theme.subjects.map((subject) => subject.id));
}
