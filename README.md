# Bravestone Dental API

Minimal Express API with Swagger documentation.

## Run Locally

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` if you want to change defaults.
3. Start the API:
   `npm run dev`

## URLs

- API health: `http://localhost:4000/health`
- Swagger UI: `http://localhost:4000/docs`
- OpenAPI JSON: `http://localhost:4000/openapi.json`

## Patient record image storage

Patient photos and radiographs belong in the private `patient-records` object
storage bucket, not inline in the clinic workspace JSON. Set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `backend.env`, then create or verify the private
bucket:

```text
npm run storage:records
```

The service-role key stays on the API. After an authenticated,
organization-scoped check, production browsers receive a private signed URL
that expires after two minutes and turn the response into a page-local blob
URL. Local development streams through the authenticated API instead.

For local development without Supabase, set
`ALLOW_LOCAL_RECORD_STORAGE="true"` explicitly. This writes under
`uploads/records` and is not suitable for deployment because those files are
host-local and may disappear on restart.

### Migrating legacy inline images

Apply the database migrations and take a database backup first. Then inspect the
copy plan:

```text
npm run migrate:attachments -- --dry-run
```

Copy images into object storage while retaining every base64 original:

```text
npm run migrate:attachments
```

Open representative patient records and verify that the copied images render
after a full reload. The purge is deliberately separate and verifies each
attachment's organization, record, patient, and stored checksum before removing
its base64 payload:

```text
npm run migrate:attachments -- --purge --dry-run
npm run migrate:attachments -- --purge
```

Do not run the final purge until the dry run reports no refused images and the
copied records have been checked in the application.
