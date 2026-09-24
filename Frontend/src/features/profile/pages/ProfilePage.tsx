import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import dayjs from "dayjs";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";

import {
  type ApiToken,
  type RunningInspection,
  type UserProfile,
  changePassword,
  createApiToken,
  fetchApiTokens,
  fetchMyProfile,
  fetchRunningInspections,
  getApiErrorMessage,
  revokeApiToken,
  sendVerificationEmail,
  updatePreferences,
} from "../profileApi";

const PRIMARY = "#2A276E";
const ACCENT = "#703E97";
const BG = "#F5F6FA";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return dayjs(value).format("DD-MMM-YYYY / HH:mm:ss");
}

function getStatusColor(status: string): string {
  switch (status) {
    case "Active":
      return "#1E7A3C";
    case "Inactive":
      return "#6B7280";
    case "Locked":
      return "#B3261E";
    default:
      return "#6B7280";
  }
}

/** Applies the application password policy. Returns an error string or true. */
function validateNewPassword(value: string): string | true {
  if (!value) return "New password is required.";
  if (value.length < 8) return "Password must be at least 8 characters long.";
  if (!/[A-Z]/.test(value)) return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(value)) return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(value)) return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must contain at least one special character.";
  return true;
}

type ChangePasswordData = {
  newPassword: string;
  confirmPassword: string;
};

/* -------------------------------------------------------------------------- */
/* Reusable building blocks                                                    */
/* -------------------------------------------------------------------------- */

function InfoRow({
  label,
  value,
  isStatus = false,
}: {
  label: string;
  value: string;
  isStatus?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexWrap: "wrap",
        gap: 1,
        py: 1,
        alignItems: "center",
        borderBottom: "1px solid #EEF0F3",
        "&:last-child": { borderBottom: "none" },
      }}
    >
      <Typography
        variant="body2"
        sx={{
          width: { xs: 140, sm: 200 },
          flexShrink: 0,
          color: "text.secondary",
          fontWeight: 600,
        }}
      >
        {label}
      </Typography>

      {isStatus ? (
        <Chip
          size="small"
          label={value}
          sx={{
            bgcolor: `${getStatusColor(value)}1A`,
            color: getStatusColor(value),
            fontWeight: 700,
          }}
        />
      ) : (
        <Typography
          variant="body2"
          sx={{ color: "#1B1B1B", fontWeight: 500, wordBreak: "break-word" }}
        >
          {value}
        </Typography>
      )}
    </Box>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        border: "1px solid #EAECEF",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
      }}
    >
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", color: PRIMARY }}>
            {icon}
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "#1B1B1B" }}>
            {title}
          </Typography>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* REST API token dialog                                                       */
/* -------------------------------------------------------------------------- */

type ApiTokenDialogProps = {
  open: boolean;
  onClose: () => void;
  tokens: ApiToken[];
  loading: boolean;
  tokenName: string;
  setTokenName: (value: string) => void;
  creating: boolean;
  createdToken: { value: string; name: string } | null;
  onCreate: () => void;
  onRevoke: (id: string) => void;
  onCopy: (value: string) => void;
};

function ApiTokenDialog({
  open,
  onClose,
  tokens,
  loading,
  tokenName,
  setTokenName,
  creating,
  createdToken,
  onCreate,
  onRevoke,
  onCopy,
}: ApiTokenDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          fontWeight: 700,
          color: PRIMARY,
        }}
      >
        <KeyOutlinedIcon /> REST API Token
      </DialogTitle>

      <DialogContent sx={{ pb: 2 }}>
        <Divider sx={{ mb: 2 }} />

        {/* Generate new token */}
        <Typography sx={{ fontWeight: 600, mb: 1 }}>
          Generate New Token
        </Typography>

        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="Token name (e.g. CI/CD pipeline)"
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            disabled={creating}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreate();
            }}
          />

          <Button
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            disabled={creating || !tokenName.trim()}
            onClick={onCreate}
            sx={{
              bgcolor: PRIMARY,
              "&:hover": { bgcolor: "#201F59" },
              whiteSpace: "nowrap",
              px: 2,
              flexShrink: 0,
            }}
          >
            {creating ? "Creating..." : "Generate"}
          </Button>
        </Stack>

        {/* Raw token — shown only once, right after creation */}
        {createdToken && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              borderRadius: 2,
              bgcolor: "#F7F2FF",
              border: `1px solid ${ACCENT}`,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
              Your new API token (shown only once)
            </Typography>

            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  wordBreak: "break-all",
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: PRIMARY,
                }}
              >
                {createdToken.value}
              </Typography>

              <Tooltip title="Copy token">
                <IconButton
                  size="small"
                  onClick={() => onCopy(createdToken.value)}
                  sx={{ color: PRIMARY }}
                >
                  <ContentCopyOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              Copy this token now. For security it is stored only as a hash and
              cannot be shown again.
            </Typography>
          </Box>
        )}

        {/* Existing tokens */}
        <Typography sx={{ fontWeight: 600, mb: 1, mt: 3 }}>
          Active Tokens
        </Typography>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : tokens.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No API tokens exist yet.
          </Typography>
        ) : (
          <List disablePadding>
            {tokens.map((token) => (
              <ListItem
                key={token.id}
                disableGutters
                sx={{ px: 0, py: 0.5 }}
              >
                <Box sx={{ display: "flex", alignItems: "center", width: "100%", gap: 1 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {token.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Created {dayjs(token.createdAt).format("DD-MMM-YYYY")}
                      {token.lastUsedAt
                        ? ` · Last used ${dayjs(token.lastUsedAt).format(
                            "DD-MMM-YYYY"
                          )}`
                        : " · Never used"}
                    </Typography>
                  </Box>

                  <Tooltip title="Revoke token">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onRevoke(token.id)}
                    >
                      <DeleteOutlineOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", color: "#50575e" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Main profile page                                                           */
/* -------------------------------------------------------------------------- */

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  /* Notification snackbar */
  const [notif, setNotif] = useState<
    { open: boolean; message: string; severity: "success" | "error" | "info" }
  >({ open: false, message: "", severity: "success" });

  const showNotif = (
    message: string,
    severity: "success" | "error" | "info" = "success"
  ) => setNotif({ open: true, message, severity });

  /* Running inspections */
  const [runningInspections, setRunningInspections] = useState<RunningInspection[]>([]);
  const [inspectionsLoading, setInspectionsLoading] = useState(true);

  /* Change password */
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordData>();
  const newPasswordValue = useWatch({ control, name: "newPassword" });

  /* Email notification toggle */
  const [prefBusy, setPrefBusy] = useState(false);

  /* Email verification */
  const [sendingVerification, setSendingVerification] = useState(false);

  const handleSendVerification = async () => {
    if (!profile || sendingVerification) return;
    setSendingVerification(true);
    try {
      const result = await sendVerificationEmail(profile.id);
      showNotif(result.message, "success");
      // Refresh profile to pick up updated emailVerified status
      const updated = await fetchMyProfile();
      setProfile(updated);
    } catch (err) {
      showNotif(
        err instanceof Error ? err.message : "Failed to send verification email",
        "error"
      );
    } finally {
      setSendingVerification(false);
    }
  };

  /* REST API token dialog */
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenCreating, setTokenCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<{
    value: string;
    name: string;
  } | null>(null);

  /* Load authenticated user profile */
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const result = await fetchMyProfile();
        if (active) {
          setProfile(result);
          setProfileError(null);
        }
      } catch (error) {
        if (active) setProfileError(getApiErrorMessage(error));
      } finally {
        if (active) setProfileLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /* Load running inspections */
  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const items = await fetchRunningInspections();
        if (active) setRunningInspections(items);
      } catch {
        if (active) setRunningInspections([]);
      } finally {
        if (active) setInspectionsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /* Change password handler                                              */
  /* ------------------------------------------------------------------ */

  const onPasswordSubmit = async (data: ChangePasswordData) => {
    try {
      await changePassword(data.newPassword, data.confirmPassword);
      reset({ newPassword: "", confirmPassword: "" });
      showNotif("Password changed successfully.", "success");
    } catch (error) {
      showNotif(getApiErrorMessage(error), "error");
    }
  };

  /* ------------------------------------------------------------------ */
  /* Email notification toggle handler                                    */
  /* ------------------------------------------------------------------ */

  const handleEmailToggle = async (checked: boolean) => {
    if (!profile) return;

    const previous = profile.emailNotificationsEnabled;

    // Update the UI immediately (optimistic), then call the backend.
    setProfile({ ...profile, emailNotificationsEnabled: checked });
    setPrefBusy(true);

    try {
      const result = await updatePreferences({ emailNotificationsEnabled: checked });
      setProfile((prev) =>
        prev
          ? { ...prev, emailNotificationsEnabled: result.emailNotificationsEnabled }
          : prev
      );
      showNotif(
        `Email notifications turned ${result.emailNotificationsEnabled ? "on" : "off"}.`,
        "success"
      );
    } catch (error) {
      // Restore the previous value on failure.
      setProfile((prev) =>
        prev ? { ...prev, emailNotificationsEnabled: previous } : prev
      );
      showNotif(getApiErrorMessage(error), "error");
    } finally {
      setPrefBusy(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* REST API token handlers                                              */
  /* ------------------------------------------------------------------ */

  const loadTokens = async () => {
    setTokensLoading(true);
    try {
      setTokens(await fetchApiTokens());
    } catch (error) {
      showNotif(getApiErrorMessage(error), "error");
    } finally {
      setTokensLoading(false);
    }
  };

  const openTokenDialog = async () => {
    setTokenDialogOpen(true);
    setTokenName("");
    setCreatedToken(null);
    await loadTokens();
  };

  const handleCreateToken = async () => {
    if (!tokenName.trim()) return;

    setTokenCreating(true);
    try {
      const { token, metadata } = await createApiToken(tokenName.trim());
      setCreatedToken({ value: token, name: metadata.name });
      setTokenName("");
      await loadTokens();
    } catch (error) {
      showNotif(getApiErrorMessage(error), "error");
    } finally {
      setTokenCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    try {
      await revokeApiToken(tokenId);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
      showNotif("API token revoked.", "success");
    } catch (error) {
      showNotif(getApiErrorMessage(error), "error");
    }
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showNotif("Copied to clipboard.", "success");
    } catch {
      showNotif("Unable to copy automatically. Please copy it manually.", "error");
    }
  };

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 72px)",
        bgcolor: BG,
        py: 4,
        px: { xs: 2, md: 6 },
      }}
    >
      <Box sx={{ maxWidth: 980, mx: "auto" }}>
        {/* Header */}
        <Typography variant="h4" sx={{ fontWeight: 700, color: "#1B1B1B" }}>
          User Profile
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          Manage your account details, security, notifications and API access.
        </Typography>

        {/* Loading */}
        {profileLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error (no profile fallback available) */}
        {!profileLoading && profileError && !profile && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {profileError}
          </Alert>
        )}

        {profile && (
          <Stack spacing={3} sx={{ mt: 3 }}>
            {/* 1. User Profile */}
            <SectionCard title="User Profile" icon={<PersonOutlineOutlinedIcon />}>
              <InfoRow label="Email" value={profile.email} />
              <InfoRow label="First Name" value={profile.firstName} />
              <InfoRow label="Last Name" value={profile.lastName} />
              <InfoRow label="Account Expiry" value={formatDateTime(profile.accountExpiry)} />
              <InfoRow label="Password Expiry" value={formatDateTime(profile.passwordExpiry)} />
              <InfoRow label="Creation Date" value={formatDateTime(profile.createdAt)} />
              <InfoRow label="Account Type" value={profile.accountType} />
              <InfoRow label="Account Status" value={profile.accountStatus} isStatus />
              <InfoRow label="Company" value={profile.company} />
            </SectionCard>

            {/* 2. Email Verification */}
            <SectionCard title="Email Verification" icon={<EmailOutlinedIcon />}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 2,
                }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>
                    {profile.emailVerified ? "Verified" : "Not Verified"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {profile.emailVerified
                      ? "Your email address has been verified."
                      : "Verify your email to confirm your identity."}
                  </Typography>
                </Box>
                {!profile.emailVerified && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={
                      sendingVerification ? (
                        <CircularProgress size={16} />
                      ) : (
                        <SendOutlinedIcon fontSize="small" />
                      )
                    }
                    onClick={handleSendVerification}
                    disabled={sendingVerification}
                    sx={{
                      textTransform: "none",
                      borderColor: PRIMARY,
                      color: PRIMARY,
                      "&:hover": { borderColor: ACCENT, bgcolor: "rgba(112,62,151,.06)" },
                    }}
                  >
                    {sendingVerification ? "Sending..." : "Send Verification Email"}
                  </Button>
                )}
              </Box>
            </SectionCard>

            {/* 3. Change Password */}
            <SectionCard title="Change Password" icon={<LockOutlinedIcon />}>
              <form onSubmit={handleSubmit(onPasswordSubmit)}>
                <Stack spacing={2}>
                  <TextField
                    fullWidth
                    label="New Password"
                    type="password"
                    {...register("newPassword", {
                      validate: validateNewPassword,
                    })}
                    error={!!errors.newPassword}
                    helperText={errors.newPassword?.message}
                  />

                  <TextField
                    fullWidth
                    label="Confirm Password"
                    type="password"
                    {...register("confirmPassword", {
                      required: "Confirm password is required.",
                      validate: (value) =>
                        value === newPasswordValue || "Passwords do not match.",
                    })}
                    error={!!errors.confirmPassword}
                    helperText={errors.confirmPassword?.message}
                  />

                  <Typography variant="caption" color="text.secondary">
                    Password must be at least 8 characters and include an
                    uppercase letter, a lowercase letter, a number and a special
                    character.
                  </Typography>

                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isSubmitting}
                    sx={{
                      alignSelf: "flex-start",
                      mt: 1,
                      bgcolor: PRIMARY,
                      textTransform: "none",
                      fontWeight: 600,
                      "&:hover": { bgcolor: "#201F59" },
                    }}
                  >
                    {isSubmitting ? "Changing..." : "Change password"}
                  </Button>
                </Stack>
              </form>
            </SectionCard>

            {/* 3. Email Notification */}
            <SectionCard title="Email Notification" icon={<NotificationsOutlinedIcon />}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 2,
                }}
              >
                <Box sx={{ maxWidth: 520 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    Email Notification
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Receive email updates when an inspection completes or an
                    action requires your attention.
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: profile.emailNotificationsEnabled ? 700 : 400,
                      color: profile.emailNotificationsEnabled
                        ? "success.main"
                        : "text.secondary",
                    }}
                  >
                    {profile.emailNotificationsEnabled ? "ON" : "OFF"}
                  </Typography>

                  <Switch
                    checked={profile.emailNotificationsEnabled}
                    disabled={prefBusy}
                    onChange={(event) => handleEmailToggle(event.target.checked)}
                    color="primary"
                  />
                </Stack>
              </Box>
            </SectionCard>

            {/* 4. Custom Setups — Current Running Inspections */}
            <SectionCard title="Custom Setups" icon={<SettingsOutlinedIcon />}>
              <Typography sx={{ fontWeight: 600 }}>
                Current Running Inspections
              </Typography>

              <Box sx={{ mt: 2 }}>
                {inspectionsLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                    <CircularProgress size={28} />
                  </Box>
                ) : runningInspections.length === 0 ? (
                  <Box
                    sx={{
                      textAlign: "center",
                      py: 4,
                      color: "text.secondary",
                      border: "1px dashed #D5D9DD",
                      borderRadius: 2,
                    }}
                  >
                    <HourglassEmptyOutlinedIcon
                      sx={{ fontSize: 44, color: "#C0C4CC" }}
                    />
                    <Typography sx={{ mt: 1, fontWeight: 600, color: "#1B1B1B" }}>
                      No running inspections
                    </Typography>
                    <Typography variant="body2">
                      Inspections you are currently performing will appear here.
                    </Typography>
                  </Box>
                ) : (
                  <List disablePadding>
                    {runningInspections.map((item) => (
                      <ListItem
                        key={item.sessionId}
                        disableGutters
                        sx={{ px: 0, py: 0.5 }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            width: "100%",
                            gap: 1,
                            flexWrap: "wrap",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {item.inspectionType}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.masterFileName} → {item.sampleFileName}
                            </Typography>
                          </Box>
                          <Box sx={{ textAlign: "right" }}>
                            <Chip
                              size="small"
                              label={item.status}
                              sx={{ bgcolor: "#EAF3FF", color: "#1E6BB8", fontWeight: 700 }}
                            />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: "block", mt: 0.25 }}
                            >
                              Started {formatDateTime(item.startedAt)}
                            </Typography>
                          </Box>
                        </Box>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            </SectionCard>

            {/* 5. REST API */}
            <SectionCard title="REST API" icon={<KeyOutlinedIcon />}>
              <Typography variant="body2" color="text.secondary">
                Manage API tokens used to access the MedInspect REST API
                programmatically. Raw tokens are shown only once at creation.
              </Typography>

              <Button
                variant="outlined"
                startIcon={<KeyOutlinedIcon />}
                onClick={openTokenDialog}
                sx={{
                  mt: 2,
                  textTransform: "none",
                  fontWeight: 600,
                  borderColor: PRIMARY,
                  color: PRIMARY,
                  "&:hover": {
                    borderColor: ACCENT,
                    bgcolor: "rgba(42,39,110,0.04)",
                  },
                }}
              >
                REST API Token
              </Button>
            </SectionCard>
          </Stack>
        )}

        {/* REST API token dialog */}
        <ApiTokenDialog
          open={tokenDialogOpen}
          onClose={() => setTokenDialogOpen(false)}
          tokens={tokens}
          loading={tokensLoading}
          tokenName={tokenName}
          setTokenName={setTokenName}
          creating={tokenCreating}
          createdToken={createdToken}
          onCreate={handleCreateToken}
          onRevoke={handleRevokeToken}
          onCopy={copyToClipboard}
        />

        {/* Notification snackbar */}
        <Snackbar
          open={notif.open}
          autoHideDuration={4000}
          onClose={() => setNotif((prev) => ({ ...prev, open: false }))}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert
            severity={notif.severity}
            variant="filled"
            sx={{ width: "100%" }}
            onClose={() => setNotif((prev) => ({ ...prev, open: false }))}
          >
            {notif.message}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}