import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import LockResetOutlinedIcon from "@mui/icons-material/LockResetOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { Controller, useForm } from "react-hook-form";

import {
  createUser,
  deleteUser,
  disableUser,
  enableUser,
  getUsers,
  resetUserPassword,
  updateUser,
  type AccountTypeOption,
  type User,
  type UserStatus,
} from "../systemApi";
import { BRAND_NAVY, fmtDate, fmtDateTime } from "../components/adminUtils";
import { ConfirmDialog, DetailDialog, SnackBar, type Snack } from "../components/adminUi";

const ACCOUNT_TYPES: AccountTypeOption[] = ["User", "Reviewer", "Administrator", "Tenant Admin"];
const STATUSES: UserStatus[] = ["Active", "Inactive", "Locked"];
const COLUMNS = [
  "Username",
  "Email",
  "First Name",
  "Last Name",
  "Account Type",
  "Status",
  "Company",
  "Last Login",
  "Created Date",
  "Actions",
];

const statusChip = (status: UserStatus) => (
  <Chip
    size="small"
    label={status}
    color={status === "Active" ? "success" : status === "Locked" ? "error" : "warning"}
    sx={{ fontWeight: 600 }}
  />
);

type FormValues = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  accountType: AccountTypeOption;
  company: string;
  accountStatus: UserStatus;
  password: string;
  confirmPassword: string;
  emailNotificationEnabled: string;
};

type ConfirmKind = "disable" | "enable" | "reset" | "delete";

const CONFIRM_TEXT: Record<ConfirmKind, (name: string) => string> = {
  disable: (n) => `Disable the account "${n}"? The user will no longer be able to log in.`,
  enable: (n) => `Re-enable the account "${n}"?`,
  reset: (n) => `Send a password reset for "${n}"? The user will be required to set a new password at next login.`,
  delete: (n) => `Permanently delete the user "${n}"? This action cannot be undone.`,
};

function UserFormDialog({
  open,
  user,
  existingUsernames,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: User | null;
  existingUsernames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<FormValues>();

  useEffect(() => {
    if (open) {
      reset(
        user
          ? {
              username: user.username,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              accountType: user.accountType,
              company: user.company,
              accountStatus: user.accountStatus,
              password: "",
              confirmPassword: "",
              emailNotificationEnabled: String(user.emailNotificationEnabled),
            }
          : {
              username: "",
              email: "",
              firstName: "",
              lastName: "",
              accountType: "User",
              company: "Viatris",
              accountStatus: "Active",
              password: "",
              confirmPassword: "",
              emailNotificationEnabled: "true",
            }
      );
    }
  }, [open, user, reset]);

  const save = async (values: FormValues) => {
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await updateUser(user.id, {
          email: values.email,
          firstName: values.firstName,
          lastName: values.lastName,
          accountType: values.accountType,
          company: values.company,
          accountStatus: values.accountStatus,
          emailNotificationEnabled: values.emailNotificationEnabled === "true",
        });
        onSaved(`User "${values.username}" updated.`);
      } else {
        await createUser({
          username: values.username,
          email: values.email,
          firstName: values.firstName,
          lastName: values.lastName,
          accountType: values.accountType,
          company: values.company,
          accountStatus: values.accountStatus,
          password: values.password,
          confirmPassword: values.confirmPassword,
          emailNotificationEnabled: values.emailNotificationEnabled === "true",
        });
        onSaved(`User "${values.username}" created.`);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, color: BRAND_NAVY }}>{user ? "Edit User" : "Add User"}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 2 }}>
            {error}
          </Typography>
        )}

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, pt: 0.5 }}>
          <Controller
            name="username"
            control={control}
            rules={{
              required: "Username is required.",
              validate: (value) =>
                !!user || !existingUsernames.includes(value.trim()) || "Username already exists.",
            }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Username *"
                size="small"
                disabled={Boolean(user)}
                error={Boolean(errors.username)}
                helperText={errors.username?.message ?? (user ? "Username cannot be changed." : " ")}
              />
            )}
          />

          <Controller
            name="email"
            control={control}
            rules={{
              required: "Email is required.",
              pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address." },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Email *"
                size="small"
                error={Boolean(errors.email)}
                helperText={errors.email?.message ?? " "}
              />
            )}
          />

          <Controller
            name="firstName"
            control={control}
            rules={{ required: "First name is required." }}
            render={({ field }) => (
              <TextField
                {...field}
                label="First Name *"
                size="small"
                error={Boolean(errors.firstName)}
                helperText={errors.firstName?.message ?? " "}
              />
            )}
          />

          <Controller
            name="lastName"
            control={control}
            rules={{ required: "Last name is required." }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Last Name *"
                size="small"
                error={Boolean(errors.lastName)}
                helperText={errors.lastName?.message ?? " "}
              />
            )}
          />

          <Controller
            name="accountType"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Account Type *" size="small">
                {ACCOUNT_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name="company"
            control={control}
            render={({ field }) => <TextField {...field} label="Company" size="small" />}
          />

          <Controller
            name="accountStatus"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Account Status" size="small">
                {STATUSES.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <Controller
            name="emailNotificationEnabled"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Email Notification" size="small">
                <MenuItem value="true">Enabled</MenuItem>
                <MenuItem value="false">Disabled</MenuItem>
              </TextField>
            )}
          />

          {!user && (
            <>
              <Controller
                name="password"
                control={control}
                rules={{
                  required: "Password is required.",
                  pattern: {
                    value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
                    message: "Min 8 chars with upper, lower, digit and special character.",
                  },
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="password"
                    label="Password *"
                    size="small"
                    error={Boolean(errors.password)}
                    helperText={errors.password?.message ?? " "}
                  />
                )}
              />

              <Controller
                name="confirmPassword"
                control={control}
                rules={{
                  required: "Confirm password is required.",
                  validate: (value) => value === getValues("password") || "Passwords do not match.",
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="password"
                    label="Confirm Password *"
                    size="small"
                    error={Boolean(errors.confirmPassword)}
                    helperText={errors.confirmPassword?.message ?? " "}
                  />
                )}
              />
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button onClick={handleSubmit(save)} variant="contained" disabled={busy} sx={{ bgcolor: BRAND_NAVY }}>
          {busy ? <CircularProgress size={20} color="inherit" /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [viewUser, setViewUser] = useState<User | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmKind | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<Snack>(null);

  const load = () => {
    getUsers()
      .then(setUsers)
      .catch((err: Error) => setError(err.message));
  };

  useEffect(() => {
    let active = true;

    const doLoad = async () => {
      try {
        const data = await getUsers();
        if (active) setUsers(data);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load users.");
      }
    };

    void doLoad();
    return () => {
      active = false;
    };
  }, []);

  const usernames = useMemo(() => (users ?? []).map((user) => user.username), [users]);
  const paged = useMemo(
    () => (users ?? []).slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [users, page, rowsPerPage]
  );

  const runAction = async () => {
    if (!confirmAction || !confirmTarget) return;
    setBusy(true);
    try {
      if (confirmAction === "disable") await disableUser(confirmTarget.id);
      else if (confirmAction === "enable") await enableUser(confirmTarget.id);
      else if (confirmAction === "reset") await resetUserPassword(confirmTarget.id);
      else await deleteUser(confirmTarget.id);

      setSnack({
        message:
          confirmAction === "disable"
            ? `User "${confirmTarget.username}" disabled.`
            : confirmAction === "enable"
              ? `User "${confirmTarget.username}" enabled.`
              : confirmAction === "reset"
                ? `Password reset issued for "${confirmTarget.username}".`
                : `User "${confirmTarget.username}" deleted.`,
        severity: "success",
      });
      setConfirmAction(null);
      setConfirmTarget(null);
      load();
    } catch (err) {
      setSnack({ message: err instanceof Error ? err.message : "Action failed.", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const detailRows = viewUser
    ? ([
        ["Username:", viewUser.username],
        ["Email:", viewUser.email],
        ["First Name:", viewUser.firstName],
        ["Last Name:", viewUser.lastName],
        ["Account Type:", viewUser.accountType],
        ["Account Status:", viewUser.accountStatus],
        ["Company:", viewUser.company],
        ["Last Login:", fmtDateTime(viewUser.lastLogin)],
        ["Password Expiry:", fmtDateTime(viewUser.passwordExpiry)],
        ["Creation Date:", fmtDateTime(viewUser.createdAt)],
        ["Email Notification:", viewUser.emailNotificationEnabled ? "Enabled" : "Disabled"],
      ] as Array<[string, string]>)
    : [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: BRAND_NAVY }}>
          User Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddOutlinedIcon />}
          onClick={() => {
            setEditUser(null);
            setFormOpen(true);
          }}
          sx={{ bgcolor: BRAND_NAVY, "&:hover": { bgcolor: "#1E1B54" } }}
        >
          Add User
        </Button>
      </Box>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      <TableContainer sx={{ border: "1px solid #E0E0E6", borderRadius: 2, bgcolor: "#fff" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F5F6FA" }}>
              {COLUMNS.map((header) => (
                <TableCell key={header} sx={{ fontWeight: 700, color: BRAND_NAVY, whiteSpace: "nowrap" }}>
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!users ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 5 }}>
                  <Typography color="text.secondary">No users found. Click "Add User" to create one.</Typography>
                </TableCell>
              </TableRow>
            ) : (
              paged.map((user) => (
                <TableRow key={user.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{user.username}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.firstName}</TableCell>
                  <TableCell>{user.lastName}</TableCell>
                  <TableCell>{user.accountType}</TableCell>
                  <TableCell>{statusChip(user.accountStatus)}</TableCell>
                  <TableCell>{user.company}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(user.lastLogin)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(user.createdAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="View">
                      <IconButton size="small" onClick={() => setViewUser(user)}>
                        <VisibilityOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditUser(user);
                          setFormOpen(true);
                        }}
                      >
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={user.accountStatus === "Active" ? "Disable" : "Enable"}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setConfirmAction(user.accountStatus === "Active" ? "disable" : "enable");
                          setConfirmTarget(user);
                        }}
                      >
                        {user.accountStatus === "Active" ? (
                          <BlockOutlinedIcon fontSize="small" />
                        ) : (
                          <CheckCircleOutlineOutlinedIcon fontSize="small" />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Reset Password">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setConfirmAction("reset");
                          setConfirmTarget(user);
                        }}
                      >
                        <LockResetOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => {
                          setConfirmAction("delete");
                          setConfirmTarget(user);
                        }}
                      >
                        <DeleteOutlineOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={users?.length ?? 0}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25]}
        />
      </TableContainer>

      <UserFormDialog
        open={formOpen}
        user={editUser}
        existingUsernames={usernames}
        onClose={() => setFormOpen(false)}
        onSaved={(message) => {
          setSnack({ message, severity: "success" });
          load();
        }}
      />

      <DetailDialog
        open={Boolean(viewUser)}
        title="User Profile"
        rows={detailRows}
        onClose={() => setViewUser(null)}
      />

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title="Please Confirm"
        message={confirmAction && confirmTarget ? CONFIRM_TEXT[confirmAction](confirmTarget.username) : ""}
        confirmLabel={confirmAction === "delete" ? "Delete" : "Confirm"}
        confirmColor={confirmAction === "delete" ? "error" : "primary"}
        busy={busy}
        onClose={() => setConfirmAction(null)}
        onConfirm={runAction}
      />

      <SnackBar snack={snack} onClose={() => setSnack(null)} />
    </Box>
  );
}

