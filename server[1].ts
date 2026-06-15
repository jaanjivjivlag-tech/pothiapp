import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { AccessToken } from "livekit-server-sdk";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Load Firebase configuration
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));

// Initialize Firebase Admin
admin.initializeApp({
  projectId: firebaseConfig.projectId,
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Secure LiveKit Token Generation endpoint
  app.post("/api/livekit-token", async (req, res) => {
    try {
      const { roomName, identity, name } = req.body;
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.warn("[Backend Security WARNING] Request blocked: Missing or invalid Authorization header.");
        return res.status(401).json({ error: "Missing or invalid authorization token." });
      }

      const idToken = authHeader.split(" ")[1];
      let decodedToken;
      try {
        decodedToken = await getAuth().verifyIdToken(idToken);
      } catch (tokenErr: any) {
        console.error("[Backend Security FAILURE] Invalid Firebase ID Token:", tokenErr.message);
        return res.status(401).json({ error: "Invalid identity credentials." });
      }

      const email = decodedToken.email;
      if (!roomName || !identity) {
        return res.status(400).json({ error: "roomName and identity are required." });
      }

      // STRICT ROLE ASSIGNMENT: Only the exact privileged email gets admin privileges
      const isPrivileged = email === "jaanjivjivlag@gmail.com";
      const userRole = isPrivileged ? "super_admin" : "member";

      const apiKey = process.env.LIVEKIT_API_KEY || "APIi9bGv39m9TL4";
      const apiSecret = process.env.LIVEKIT_API_SECRET || "O3eNJXYxxJ0Esb6f1JvGcs3NVY1CCuVJUVmocTLBeE5B";

      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        name: name || (email ? email.split('@')[0] : 'User'),
      });

      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true, // Allow standard speakers to publish as well (once approved)
        canPublishData: true,
        canSubscribe: true,
        roomAdmin: isPrivileged, // true only for jaanjivjivlag@gmail.com
      });

      const token = await at.toJwt();
      console.log(`[Backend LiveKit Token SUCCESS] Generated secure token for identity="${identity}", verifiedEmail="${email}", role="${userRole}", isAdmin=${isPrivileged}`);
      
      res.json({ 
        token, 
        lkUrl: process.env.LIVEKIT_URL || "wss://voxroom-gunciw2r.livekit.cloud" 
      });
    } catch (err: any) {
      console.error("[Backend LiveKit Token FAILURE]:", err);
      res.status(500).json({ error: err.message || "Token generation failed" });
    }
  });

  // Serve static assets or mount Vite middleware
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode with static direct hosting...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`LiveKit API URL configured: ${process.env.LIVEKIT_URL || "wss://voxroom-gunciw2r.livekit.cloud"}`);
  });
}

startServer();
