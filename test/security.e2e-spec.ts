import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
// Mocking before imports that use it might be needed, but separate line is fine.
// We mock the file relative to this test file.
jest.mock("../src/supabase/supabase.guard", () => {
  return {
    SupabaseGuard: class {
      canActivate(context: {
        switchToHttp: () => {
          getRequest: () => {
            headers: Record<string, string | undefined>;
            user?: { sub: string };
          };
        };
      }) {
        const req = context.switchToHttp().getRequest();
        const mockId = req.headers["x-mock-user-id"];
        if (mockId) {
          req.user = { sub: mockId };
          return true;
        }
        return false;
      }
    },
  };
});

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { Role } from "@prisma/client";

describe("Security (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let organizerUser: { supabaseUserId: string };
  let participant1: { id: string; supabaseUserId: string };
  let participant2: { supabaseUserId: string };
  let team1: { id: string };

  beforeAll(async () => {
    // No overrides needed if mocked via jest.mock
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get<PrismaService>(PrismaService);
    await app.init();

    // Cleanup
    await prisma.evaluation.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.team.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { contains: "test_sec_" } },
    });

    // Setup Users
    organizerUser = await prisma.user.create({
      data: {
        email: "test_sec_org@example.com",
        firstname: "Org",
        lastname: "One",
        supabaseUserId: "sup_org_1",
        role: Role.ORGANIZER,
      },
    });

    participant1 = await prisma.user.create({
      data: {
        email: "test_sec_p1@example.com",
        firstname: "P1",
        lastname: "One",
        supabaseUserId: "sup_p1_1",
        role: Role.PARTICIPANT,
      },
    });

    participant2 = await prisma.user.create({
      data: {
        email: "test_sec_p2@example.com",
        firstname: "P2",
        lastname: "One",
        supabaseUserId: "sup_p2_1",
        role: Role.PARTICIPANT,
      },
    });

    // Create Team for Participant 1
    team1 = await prisma.team.create({
      data: {
        name: "SecurityTestTeam",
        themeId: "theme1",
        subjectId: "subject1",
        members: {
          connect: { id: participant1.id },
        },
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { contains: "test_sec_" } },
      });
      await prisma.team.deleteMany({ where: { id: team1.id } });
    }
    await app.close();
  });

  describe("Announcement Controller (RBAC)", () => {
    it("should allow Organizer to create announcement", () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      return request(server)
        .post("/announcement")
        .set("x-mock-user-id", organizerUser.supabaseUserId)
        .send({
          title: "Test Announcement",
          content: "Security Check",
          author: "Org",
        })
        .expect(201);
    });

    it("should DENY Participant to create announcement", () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      return request(server)
        .post("/announcement")
        .set("x-mock-user-id", participant1.supabaseUserId)
        .send({
          title: "Hacked Announcement",
          content: "I am P1",
          author: "P1",
        })
        .expect(403);
    });
  });

  describe("Team Service (Update Permissions)", () => {
    it("should allow Member to update their team", () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      return request(server)
        .put(`/team/${team1.id}`)
        .set("x-mock-user-id", participant1.supabaseUserId)
        .send({
          name: "Updated by Member",
        })
        .expect(200);
    });

    it("should allow Organizer to update any team", () => {
      // First, confirm the name was updated by participant1
      // Then update again by organizer
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      return request(server)
        .put(`/team/${team1.id}`)
        .set("x-mock-user-id", organizerUser.supabaseUserId)
        .send({
          name: "Updated by Organizer",
        })
        .expect(200);
    });

    it("should DENY Non-Member Participant to update team", () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      return request(server)
        .put(`/team/${team1.id}`)
        .set("x-mock-user-id", participant2.supabaseUserId)
        .send({
          name: "Hacked by P2",
        })
        .expect(403);
    });
  });
});
