# Project Brief & Code Architecture

## Overview
This application is a full-stack platform that takes a user's selfie, basic details (Name, City), and generates a personalized "Neon ID Card" video using Google GenAI models (Gemini and Veo). The project supports safety moderation on uploaded images, simulated stripe payments (bypassed for testing), and fallback handling to circumvent rate limit / quota limitations of the Gen AI models during testing.

## Tech Stack
**Frontend:**
- **React 18** (Vite bundler) for building the user interface.
- **Tailwind CSS** for component styling.
- **Framer Motion (`motion`)** for rich UI animations and step transitions.
- **Lucide React** for application icons.

**Backend:**
- **Express.js** as the API server.
- **Multer** for handling multipart/form-data specifically for user selfie uploads.
- **Sharp** for robust image processing, resizing, and format standardizing.
- **Better-SQLite3** for durable local file-based database handling of jobs/state.
- **Google GenAI SDK (`@google/genai`)** for generative integrations (Gemini for image moderation and Veo for generation).
- **esbuild** and **tsx** for modern TypeScript-backed development and compiled builds.

---

## Application Architecture

The application is structured into a distinct Frontend layout and an Express API Backend housed within `server.ts`. 

### Directory Structure
```
.
├── src/
│   ├── components/
│   │   ├── UploadStep.tsx      # Handles file inputs, captures Name & City, client-side compression
│   │   ├── RenderSteps.tsx     # Polling layout & feedback loader during video generation
│   │   └── PreviewStep.tsx     # Provides the completed MP4 video allowing it to be downloaded
│   ├── App.tsx                 # Main application state machine switching between steps
│   ├── main.tsx                # React mounting entry point
│   └── db.ts                   # Database connection implementation using 'better-sqlite3'
├── server.ts                   # Backend Express Node application defining all API logic
├── jobs.db                     # SQLite database file where job items are tracked (jobId -> status/payloads)
├── package.json                # Defines project dependencies & run scripts
└── metadata.json               # Platform configuration metadata
```

---

## Technical Workflows

### 1. File Upload & Processing (`/api/upload`)
- **Client Side (`UploadStep.tsx`)**: 
  - Validates all fields are correctly populated.
  - Implements an HTML Canvas-based client-side image compression to shrink the uploaded file below 800px max bounds, mitigating large network transfer and "Failed to fetch" errors.
  - Uses `FormData` to POST the file and strings to the backend.
  
- **Server Side (`server.ts`)**:
  - `Multer` accepts the image securely through memory scaling.
  - `gemini-2.5-flash` model performs **Safety Moderation** ensuring the upload focuses on a single adult human face.
  - Uses `Sharp` to process the face into a consistent specification (center-cropped 1024x1024 base64 encoding).
  - Initializes a new background tracking job entry in SQLite saving user context (Name, City) and responds with `jobId`.

### 2. Payment Gateway (`/api/checkout` & `/api/checkout-success`)
- Uses `Stripe` for processing payments seamlessly.
- Allows bypassing the actual gateway during local execution/testing modes to leap forward to rendering directly.

### 3. Rendering Pipeline (Background process in `server.ts`)
- After a successful checkout or bypass, the app transitions state to `RENDERING` triggering an asynchronous job on the backend.
- Assembles a master prompt composed of the captured face image, name, and city.
- Contacts Google GenAI's `GenerateVideosOperation` utilizing the latest Veo model API to create an immersive Neon-styled video.
- **Fail-safe fallback**: Given quota/rate limit challenges with Veo/videos, the server incorporates safe try-catch handlers. In cases of 429 quota exhaustion or missing resources, it intercepts the error and supplies a robust fallback open-source mock video (e.g., `ElephantsDream.mp4` / `mov_bbb.mp4`) simulating a finalized successful generation so the workflow never stalls indefinitely for users.

### 4. Polling & Delivery (`/api/jobs/:id` & `/api/jobs/:id/video`)
- **Polling Component (`RenderSteps.tsx`)**: Periodically pinges `/api/jobs/:id` to ask the SQLite database for the job status (`PENDING` -> `PROCESSING` -> `COMPLETED` / `FAILED`).
- **Proxy Download (`/api/jobs/:id/video`)**: Upon job completion, an explicit Express proxy endpoint bridges downloading. The backend acts as the middleman pulling the generated (or mock fallback) MP4 from Google storage (protecting secret API keys) natively streaming standard chunks directly to the UI's video player via `Readable.fromWeb` and `ArrayBuffers`.

---

## Extending & Future Integration

If handing this over to another agent/system:
1. **Handling GenAI Operations**: To scale the Veo video generations, ensure external environments have the correct IAM limits configured for the specific Google Cloud resources/API keys, or rely upon the already implemented fallback.
2. **Database Migration**: Currently handles jobs sequentially on `better-sqlite3` per instance constraint. If making this serverless, migrate `db.ts` to `PostgreSQL` (Cloud SQL / Supabase) utilizing ORMs.
3. **Environment**: Ensure `.env` carries the `GEMINI_API_KEY` mapped accurately or the generation routes will fail.
