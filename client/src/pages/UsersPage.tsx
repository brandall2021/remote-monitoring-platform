import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Tooltip,
  Snackbar,
  Alert,
  Typography,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Add, Edit, Delete } from "@mui/icons-material";
import { usersAPI, User } from "../services/api";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import { People } from "@mui/icons-material";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });
  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    roleId: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await usersAPI.list(page);
      setUsers(data.users);
      setTotal(data.total);
      setPaginationModel((prev) => ({ ...prev, page: page - 1 }));
    } catch {
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.email) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Invalid email format";
    if (!editingUser && !formData.username) errors.username = "Username is required";
    if (!editingUser && !formData.password) errors.password = "Password is required";
    else if (!editingUser && formData.password.length < 6) errors.password = "Password must be at least 6 characters";
    if (!formData.firstName) errors.firstName = "First name is required";
    if (!formData.lastName) errors.lastName = "Last name is required";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (editingUser) {
        await usersAPI.update(editingUser.id, {
          email: formData.email,
          firstName: formData.firstName,
          lastName: formData.lastName,
        });
        setSnackbar({ open: true, message: "User updated successfully", severity: "success" });
      } else {
        await usersAPI.create({
          email: formData.email,
          username: formData.username,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          roleId: formData.roleId || "OPERATOR",
        });
        setSnackbar({ open: true, message: "User created successfully", severity: "success" });
      }
      setDialogOpen(false);
      resetForm();
      loadUsers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Error saving user";
      setSnackbar({ open: true, message: msg, severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await usersAPI.delete(deletingUser.id);
      setSnackbar({ open: true, message: "User deleted", severity: "success" });
      setDeleteDialogOpen(false);
      setDeletingUser(null);
      loadUsers();
    } catch {
      setSnackbar({ open: true, message: "Failed to delete user", severity: "error" });
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      username: user.username,
      password: "",
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.role?.id || "",
    });
    setFormErrors({});
    setDialogOpen(true);
  };

  const resetForm = () => {
    setEditingUser(null);
    setFormData({ email: "", username: "", password: "", firstName: "", lastName: "", roleId: "" });
    setFormErrors({});
  };

  const columns: GridColDef[] = [
    {
      field: "username",
      headerName: "Username",
      type: "string",
      flex: 1,
      minWidth: 120,
      renderCell: (params) => (
        <Typography sx={{ fontWeight: 500, fontSize: "0.875rem" }}>{params.value}</Typography>
      ),
    },
    {
      field: "email",
      headerName: "Email",
      type: "string",
      flex: 1.5,
      minWidth: 180,
    },
    {
      field: "firstName",
      headerName: "Name",
      type: "string",
      flex: 1,
      minWidth: 130,
      renderCell: (params: { row: User }) => `${params.row.firstName} ${params.row.lastName}`,
    },
    {
      field: "role",
      headerName: "Role",
      type: "string",
      width: 140,
      renderCell: (params: { value?: { name: string } }) => (
        <Typography
          variant="caption"
          sx={{
            px: 1,
            py: 0.5,
            borderRadius: 1,
            fontWeight: 500,
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            color: "secondary.main",
          }}
        >
          {params.value?.name || "-"}
        </Typography>
      ),
    },
    {
      field: "isActive",
      headerName: "Status",
      type: "string",
      width: 100,
      renderCell: (params) => (
        <Typography
          variant="caption"
          sx={{
            px: 1,
            py: 0.5,
            borderRadius: 1,
            fontWeight: 500,
            backgroundColor: params.value ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            color: params.value ? "success.main" : "error.main",
          }}
        >
          {params.value ? "Active" : "Inactive"}
        </Typography>
      ),
    },
    {
      field: "actions",
      headerName: "",
      type: "string",
      width: 80,
      sortable: false,
      renderCell: (params: { row: User }) => (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => handleEdit(params.row)} aria-label={`Edit ${params.row.username}`}>
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              onClick={() => {
                setDeletingUser(params.row);
                setDeleteDialogOpen(true);
              }}
              aria-label={`Delete ${params.row.username}`}
            >
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Users"
        description="Manage admin accounts and permissions"
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
          >
            Add User
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => loadUsers()} />}

      {!error && users.length === 0 && !loading ? (
        <EmptyState
          icon={<People />}
          title="No users yet"
          description="Create the first admin user to get started."
          action={
            <Button variant="contained" startIcon={<Add />} onClick={() => { resetForm(); setDialogOpen(true); }}>
              Add User
            </Button>
          }
        />
      ) : (
        <Box sx={{ height: 600, width: "100%" }}>
          <DataGrid
            rows={users}
            columns={columns}
            loading={loading}
            paginationMode="server"
            rowCount={total}
            paginationModel={paginationModel}
            onPaginationModelChange={(model) => {
              setPaginationModel(model);
              loadUsers(model.page + 1);
            }}
            disableColumnFilter
            disableRowSelectionOnClick
            sx={{
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
            }}
          />
        </Box>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>{editingUser ? "Edit User" : "Create User"}</DialogTitle>
        <DialogContent sx={{ pt: "16px !important" }}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            error={!!formErrors.email}
            helperText={formErrors.email}
            sx={{ mb: 2 }}
          />
          {!editingUser && (
            <TextField
              fullWidth
              label="Username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              error={!!formErrors.username}
              helperText={formErrors.username}
              sx={{ mb: 2 }}
            />
          )}
          {!editingUser && (
            <TextField
              fullWidth
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              error={!!formErrors.password}
              helperText={formErrors.password}
              sx={{ mb: 2 }}
            />
          )}
          <TextField
            fullWidth
            label="First Name"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            error={!!formErrors.firstName}
            helperText={formErrors.firstName}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Last Name"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            error={!!formErrors.lastName}
            helperText={formErrors.lastName}
            sx={{ mb: 2 }}
          />
          <TextField fullWidth select label="Role" value={formData.roleId} onChange={(e) => setFormData({ ...formData, roleId: e.target.value })}>
            <MenuItem value="SUPER_ADMIN">Super Admin</MenuItem>
            <MenuItem value="ADMIN">Admin</MenuItem>
            <MenuItem value="OPERATOR">Operator</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: "text.secondary" }}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 600 }}>Delete User</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to delete <strong>{deletingUser?.username}</strong>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: "text.secondary" }}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
