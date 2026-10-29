/** Isolate destructive demo seeding from the developer's database and running app. */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import dotenv from "dotenv"
import { request } from "@playwright/test"
import { PrismaClient } from "../generated/prisma/index.js"

const root = process.cwd()
const local = { ...dotenv.parse(fs.readFileSync(".env")), ...process.env }
const target = new URL(local.DATABASE_URL)
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname))
  throw new Error(
    "E2E requires a local PostgreSQL host; remote databases are rejected."
  )
const database = `omnis_e2e_${randomUUID().replaceAll("-", "")}`
const adminUrl = new URL(target)
adminUrl.pathname = "/postgres"
const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() })
target.pathname = `/${database}`
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omnis-e2e-"))
const port = 3002
const env = {
  ...local,
  E2E_ISOLATED: "true",
  E2E_PASSWORD: "demo1234",
  DATABASE_URL: target.toString(),
  POSTGRES_URL_NON_POOLING: target.toString(),
  NEXT_PUBLIC_BASE_PATH: "",
  PUBLIC_URL: `http://localhost:${port}`,
  NEXTAUTH_URL: `http://localhost:${port}`,
  AUTH_URL: `http://localhost:${port}`,
  NEXT_PUBLIC_IS_DEMO: "true",
  BASE_URL: `http://localhost:${port}`,
}
let server
let created = false
let db
const run = (command, args) =>
  execFileSync(command, args, { cwd: workspace, env, stdio: "inherit" })
console.log(`E2E target: ${target.hostname}:${target.port}/${database}`)
console.log(`E2E workspace/logs: ${workspace}`)
try {
  // Fail before creating resources if another service owns the fixed test port.
  const net = await import("node:net")
  const probe = net.createServer()
  probe.listen(port)
  await once(probe, "listening")
  await new Promise((resolve) => probe.close(resolve))
  // 커밋하지 않은 새 파일도 함께 옮긴다 — push 전 게이트(test:e2e:affected)는 작업 중인 트리를 돌려야 한다.
  // 추적된 파일만 옮기면 새로 만든 테스트 도우미가 빠져 "Cannot find module" 로 깨졌다(2026-10-29)
  for (const file of execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue
    const destination = path.join(workspace, file)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(file, destination)
  }
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(workspace, "node_modules"),
    "dir"
  )
  fs.symlinkSync(
    path.join(root, "generated"),
    path.join(workspace, "generated"),
    "dir"
  )
  await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`)
  created = true
  run("npx", ["prisma", "migrate", "deploy"])
  run("npx", ["tsx", "prisma/demo-seed.ts"])
  db = new PrismaClient({ datasourceUrl: target.toString() })
  await db.user.updateMany({
    data: {
      onboardingVideoSeenAt: new Date(),
      onboardingCompletedAt: new Date(),
    },
  })
  const log = fs.openSync(path.join(workspace, "server.log"), "a")
  server = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: workspace,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  })
  fs.closeSync(log)
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null)
      throw new Error("E2E server exited; inspect server.log")
    try {
      if (
        (
          await fetch(`${env.BASE_URL}/login`, {
            signal: AbortSignal.timeout(2000),
          })
        ).ok
      ) {
        ready = true
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error("E2E server did not become ready")
  // Compile the authenticated routes before browser timeouts measure user interaction.
  const client = await request.newContext({
    baseURL: env.BASE_URL,
    timeout: 120_000,
  })
  try {
    const { csrfToken } = await (await client.get("/api/auth/csrf")).json()
    await client.post("/api/auth/callback/credentials", {
      form: {
        csrfToken,
        name: "팀장",
        password: "demo1234",
        callbackUrl: env.BASE_URL + "/tasks",
      },
    })
    const task = await db.task.findFirstOrThrow()
    for (const route of [
      "/tasks",
      `/tasks/${task.id}`,
      "/omnis",
      "/reports",
    ]) {
      const response = await client.get(route)
      if (!response.ok() || response.url().includes("/login"))
        throw new Error(`Warmup failed: ${route} (${response.status()})`)
    }
    console.log("Authenticated routes warmed successfully")
  } finally {
    await client.dispose()
  }
  // pnpm run test:e2e:local -- <파일> 은 "--" 를 그대로 넘긴다. 그대로 두면 playwright 가 그 뒤 파일 지정을 무시하고 전체를 돌렸다
  run("npm", ["run", "test:e2e", "--", "--retries=0", ...process.argv.slice(2).filter((a) => a !== "--")])
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM")
    } catch {}
    if (server.exitCode === null) await once(server, "exit")
  }
  await db?.$disconnect()
  if (created)
    await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`)
  await admin.$disconnect()
  console.log("Temporary E2E database removed; logs retained:", workspace)
}
