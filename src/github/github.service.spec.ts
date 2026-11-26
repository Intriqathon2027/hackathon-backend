import { Test, TestingModule } from "@nestjs/testing";
import { GithubService } from "./github.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigurationService } from "../configuration/configuration.service";
import { ForbiddenException } from "@nestjs/common";
import axios from "axios";
import { Role } from "@prisma/client";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("GithubService", () => {
  let service: GithubService;

  const mockUser = {
    id: "1",
    supabaseUserId: "sup_1",
    role: Role.ORGANIZER,
    github: '{"accessToken": "mock_token"}',
  };

  const mockTeam = {
    id: "team_1",
    name: "Test Team",
    members: [],
    juries: [],
    mentors: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: jest.fn().mockResolvedValue(mockUser) },
            team: { findMany: jest.fn().mockResolvedValue([mockTeam]) },
            submission: { upsert: jest.fn() },
          },
        },
        {
          provide: ConfigurationService,
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              value: { hackathonName: "Test Hackathon" },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<GithubService>(GithubService);
  });

  it("should throw ForbiddenException when 403 status occurs during repo creation", async () => {
    // Mock Org Existence check (success)
    mockedAxios.get.mockResolvedValueOnce({ status: 200 });

    // Mock Repo Creation check (403 Forbidden)
    const err403 = {
      isAxiosError: true,
      response: { status: 403 },
    };

    // Correctly mock isAxiosError to check content or just return true for our fake error
    (axios.isAxiosError as unknown as jest.Mock).mockImplementation(
      (payload: unknown) =>
        typeof payload === "object" &&
        payload !== null &&
        "isAxiosError" in payload &&
        (payload as { isAxiosError?: unknown }).isAxiosError === true,
    );

    // Make sure we reject on the FIRST post call if that's what we expect
    // or use mockImplementation to be sure.
    mockedAxios.post.mockRejectedValue(err403);

    await expect(service.initializeHackathonOrg("sup_1")).rejects.toThrow(
      ForbiddenException,
    );
  });
});
