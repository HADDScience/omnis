-- CreateEnum
CREATE TYPE "CalendarAudience" AS ENUM ('ALL', 'ADMIN');

-- CreateTable
CREATE TABLE "ExternalCalendar" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "audience" "CalendarAudience" NOT NULL DEFAULT 'ADMIN',
    "ctag" TEXT,
    "syncToken" TEXT,
    "syncedAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCalendarEvent" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "recurrenceId" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL,
    "etag" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "tzid" TEXT,
    "rrule" TEXT,
    "exdates" TIMESTAMP(3)[],
    "recurUntil" TIMESTAMP(3),
    "status" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "lastModified" TIMESTAMP(3),
    "organizer" TEXT,
    "attendees" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendar_provider_externalId_key" ON "ExternalCalendar"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ExternalCalendarEvent_calendarId_startAt_idx" ON "ExternalCalendarEvent"("calendarId", "startAt");

-- CreateIndex
CREATE INDEX "ExternalCalendarEvent_href_idx" ON "ExternalCalendarEvent"("href");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCalendarEvent_calendarId_uid_recurrenceId_key" ON "ExternalCalendarEvent"("calendarId", "uid", "recurrenceId");

-- AddForeignKey
ALTER TABLE "ExternalCalendarEvent" ADD CONSTRAINT "ExternalCalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "ExternalCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

