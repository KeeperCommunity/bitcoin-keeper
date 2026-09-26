import { Router } from "express";
import mongoose from "mongoose";

// Mounted only when LOCAL_DEV is explicitly enabled. Unsupported integrations
// fail visibly; they never silently fall back to live services.
export const localDevelopmentRoutes = Router();
localDevelopmentRoutes.get("/health", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    ready, mode: "local", network: "TESTNET",
    capabilities: { database: ready, channel: true, signing: false,
      pushDelivery: false, purchases: false, faucet: false },
  });
});

const localDatabaseRoutes = new Set([
  "/", "/createnewapp", "/getappimage", "/updateappimage",
  "/deleteappimageentity", "/deletevaults", "/updatevaultimage",
  "/getvaultmetadata", "/getsigneridinfo", "/migratexfps", "/modifylabels",
  "/getmessages", "/getsubscriptiondetails", "/updatecontactskey",
  "/createremotekey", "/getremotekey", "/backupallsignersandvaults",
  "/deletebackup", "/updatecollaborativechannel", "/fetchcollaborativechannel",
  "/gethardwarereferrallinks", "/getactivecampaign", "/getadvisors",
]);

localDevelopmentRoutes.use((req, res, next) => {
  if (localDatabaseRoutes.has(req.path.toLowerCase())) return next();
  return res.status(503).json({
    error: "LOCAL_INTEGRATION_UNAVAILABLE",
    err: "This integration is unavailable in the local development environment.",
  });
});
