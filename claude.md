# Neon-ID: Project Hand-off Document for Claude Code

Welcome to the Neon-ID project! This document outlines the architecture, tech stack, and current state of the application to help you seamlessly take over development.

## 🎯 Project Overview
Neon-ID is a web application that allows users to upload a selfie and generate a premium, 3D interactive "cyberpunk VIP ID card." 

Initially, the project used Google Veo to generate a heavy, expensive video of the card. It has recently been refactored to use a **lightweight client-side 3D parallax effect** combined with a **headless Playwright capture pipeline**. This provides users with a fun, interactive web experience *and* a shareable MP4 video for social media (TikTok/Instagram) without incurring massive AI video generation costs.

---

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite, TailwindCSS, React Router DOM, Framer Motion (\`motion/react\`), Lucide React.
- **Backend**: Node.js, Express. Runs via \`tsx\` in development.
- **Database**: SQLite3 (using \`better-sqlite3\`).
- **AI Integrations**: \`@google/genai\` (Gemini 2.5 Flash for safety checks, Gemini 2.5 Flash Image for cyberpunk stylization).
- **Image Processing**: \`sharp\` (for SVG-to-PNG compositing and alpha masking).
- **Video Capture**: \`playwright\` (Chromium headless) & \`ffmpeg-static\`.

---

## 🏗️ Architecture & Core Flows

### 1. Upload & Stylization Flow (\`server.ts\`)
- **Route:** \`POST /api/upload\`
- **Process:**
  1. Accepts an image upload via \`multer\`.
  2. Runs a fast safety check using Gemini 2.5 Flash (verifies it's an adult human face).
  3. Returns a \`jobId\` to the client immediately so it can start polling.
  4. In the background (\`buildCardInBackground\`), it calls Gemini 2.5 Flash Image to stylize the portrait into a neon-noir illustration.
  5. Uses \`sharp\` to apply an elliptical alpha mask to the portrait.
  6. Constructs 4 distinct SVG layers for the card: 
     - **Background** (guilloché patterns)
     - **Portrait** (the masked AI output)
     - **Frame** (metallic borders and holographic foil)
     - **Text** (user details and fake barcodes)
  7. Converts these SVGs to PNG buffers via \`sharp\` and saves them as Base64 strings in the SQLite database (\`jobs.db\`).

### 2. The 3D Interactive Web Viewer (\`src/components/InteractiveCard.tsx\`)
- **Route:** \`/card/:id\`
- **Process:**
  - Fetches the 4 image layers from \`/api/jobs/:id/layers\`.
  - Stacks them in a \`div\` with \`transform-style: preserve-3d\`.
  - Uses \`framer-motion\` to track mouse movement (desktop) or \`deviceorientation\` gyroscope data (mobile).
  - Applies \`translateZ\` offsets to the layers to create intense 3D parallax.
  - Shifts a \`linear-gradient\` with a \`mix-blend-color-dodge\` over the frame layer to simulate an iridescent holographic foil catching the light.

### 3. Headless Capture Pipeline (\`src/capture.ts\`)
- **Route:** \`POST /api/checkout\` (Mocked)
- **Process:**
  - Social media platforms cannot embed interactive HTML/JS. To provide users with a shareable video, we use a local headless capture system.
  - The backend spawns a hidden Playwright browser and navigates to the \`/card/:jobId\` URL.
  - Using Playwright's native \`recordVideo\` feature, it records the page.
  - The script injects programmatic mouse movements (\`Math.sin\` / \`Math.cos\` figure-8 patterns) to trigger the 3D parallax and holographic shimmer.
  - After 4 seconds, the resulting \`.webm\` is read, converted to Base64, saved in the database under the \`video_b64\` column, and the temp files are deleted.
  - The user can then download the video via \`/api/jobs/:id/mp4\`.

---

## 📂 Key Files & Directories
- **\`server.ts\`**: The Express backend. Contains the upload logic, Gemini AI calls, sharp compositing, and endpoints.
- **\`src/db.ts\`**: The SQLite database wrapper. Manages the \`jobs\` table schema and CRUD operations.
- **\`src/capture.ts\`**: The Playwright script responsible for automating the headless video capture.
- **\`src/App.tsx\`**: The main React Router setup and the sequential upload/preview/success UI flow.
- **\`src/components/InteractiveCard.tsx\`**: The highly polished 3D parallax framer-motion component.
- **\`src/components/PreviewStep.tsx\`**: The UI shown to the user while waiting for the AI to finish, offering the "Unlock HD Video" payment button.
- **\`jobs.db\`**: The local SQLite database file (created automatically).

---

## 🚀 Running the Project
1. **Environment Variables**: Ensure you have a \`.env\` file in the root with:
   \`\`\`env
   GEMINI_API_KEY=your_gemini_api_key
   \`\`\`
2. **Start the Dev Server**: 
   \`\`\`bash
   npm run dev
   \`\`\`
   This uses \`tsx\` to run \`server.ts\` directly. Vite middleware handles the React frontend.
3. **Access**: The app is served at \`http://localhost:3000\`.

---

## 📌 Current State & Next Steps
- **State**: The MVP is fully functional. The local Playwright capture pipeline works perfectly and replaces the older, slower Veo logic.
- **Database Migrations**: The schema was recently updated to include \`bg_layer_b64\`, \`frame_layer_b64\`, \`portrait_layer_b64\`, \`text_layer_b64\`, and \`video_b64\`. 
- **Areas for Improvement**:
  - Implement actual Stripe integration in \`/api/checkout\`.
  - Refine the FFmpeg transcoding if strict \`.mp4\` (H.264) compatibility is required (currently serves Playwright's native \`.webm\` format under the \`/mp4\` endpoint, which works in modern browsers but may need conversion for iOS).
  - Handle background cleanup of old jobs from the SQLite DB.

Good luck, Claude! 🤖✨
