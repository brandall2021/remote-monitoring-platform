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
      setError("Error al cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.email) errors.email = "El correo es obligatorio";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = "Formato de correo inválido";
    if (!editingUser && !formData.username) errors.username = "El nombre de usuario es obligatorio";
    if (!editingUser && !formData.password) errors.password = "La contraseña es obligatoria";
    else if (!editingUser && formData.password.length < 6) errors.password = "La contraseña debe tener al menos 6 caracteres";
    if (!formData.firstName) errors.firstName = "El nombre es obligatorio";
    if (!formData.lastName) errors.lastName = "El apellido es obligatorio";
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
        setSnackbar({ open: true, message: "Usuario actualizado correctamente", severity: "success" });
      } else {
        await usersAPI.create({
          email: formData.email,
          username: formData.username,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          roleId: formData.roleId || "OPERATOR",
        });
        setSnackbar({ open: true, message: "Usuario creado correctamente", severity: "success" });
      }
      setDialogOpen(false);
      resetForm();
      loadUsers();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Error al guardar el usuario";
      setSnackbar({ open: true, message: msg, severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await usersAPI.delete(deletingUser.id);
      setSnackbar({ open: true, message: "Usuario eliminado", severity: "success" });
      setDeleteDialogOpen(false);
      setDeletingUser(null);
      loadUsers();
    } catch {
      setSnackbar({ open: true, message: "Error al eliminar el usuario", severity: "error" });
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
      headerName: "Usuario",
      type: "string",
      flex: 1,
      minWidth: 120,
      renderCell: (params) => (
        <Typography sx={{ fontWeight: 500, fontSize: "0.875rem" }}>{params.value}</Typography>
      ),
    },
    {
      field: "email",
      headerName: "Correo",
      type: "string",
      flex: 1.5,
      minWidth: 180,
    },
    {
      field: "firstName",
      headerName: "Nombre",
      type: "string",
      flex: 1,
      minWidth: 130,
      renderCell: (params: { row: User }) => `${params.row.firstName} ${params.row.lastName}`,
    },
    {
      field: "role",
      headerName: "Rol",
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
      headerName: "Estado",
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
          {params.value ? "Activo" : "Inactivo"}
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
          <Tooltip title="Editar">
            <IconButton size="small" onClick={() => handleEdit(params.row)} aria-label={`Editar ${params.row.username}`}>
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Eliminar">
            <IconButton
              size="small"
              onClick={() => {
                setDeletingUser(params.row);
                setDeleteDialogOpen(true);
              }}
              aria-label={`Eliminar ${params.row.username}`}
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
        title="Usuarios"
        description="Gestiona las cuentas de administrador y sus permisos"
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              resetForm();
              setDialogOpen(true);
            }}
          >
            Agregar Usuario
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => loadUsers()} />}

      {!error && users.length === 0 && !loading ? (
        <EmptyState
          icon={<People />}
          title="Aún no hay usuarios"
          description="Crea el primer usuario administrador para comenzar."
          action={
            <Button variant="contained" startIcon={<Add />} onClick={() => { resetForm(); setDialogOpen(true); }}>
              Agregar Usuario
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
        <DialogTitle sx={{ fontWeight: 600 }}>{editingUser ? "Editar Usuario" : "Crear Usuario"}</DialogTitle>
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
              label="Nombre de usuario"
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
              label="Contraseña"
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
            label="Nombre"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            error={!!formErrors.firstName}
            helperText={formErrors.firstName}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Apellido"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            error={!!formErrors.lastName}
            helperText={formErrors.lastName}
            sx={{ mb: 2 }}
          />
          <TextField fullWidth select label="Rol" value={formData.roleId} onChange={(e) => setFormData({ ...formData, roleId: e.target.value })}>
            <MenuItem value="SUPER_ADMIN">Super Administrador</MenuItem>
            <MenuItem value="ADMIN">Administrador</MenuItem>
            <MenuItem value="OPERATOR">Operador</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: "text.secondary" }}>Cancelar</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : editingUser ? "Guardar Cambios" : "Crear Usuario"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 600 }}>Eliminar Usuario</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            ¿Estás seguro de que deseas eliminar a <strong>{deletingUser?.username}</strong>? Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: "text.secondary" }}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            Eliminar
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
