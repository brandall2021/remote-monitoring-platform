import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  DataGrid,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  LinearProgress,
  Tooltip,
} from "@mui/material";
import { Add, Edit, Delete } from "@mui/icons-material";
import { usersAPI } from "../services/api";
import { User } from "../types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "OPERATOR",
  });

  const loadUsers = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await usersAPI.list(page);
      setUsers(data.users);
      setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleSave = async () => {
    try {
      if (editingUser) {
        await usersAPI.update(editingUser.id, {
          email: formData.email,
          firstName: formData.firstName,
          lastName: formData.lastName,
          role: formData.role,
        });
      } else {
        await usersAPI.create(formData);
      }
      setDialogOpen(false);
      setEditingUser(null);
      setFormData({ email: "", username: "", password: "", firstName: "", lastName: "", role: "OPERATOR" });
      loadUsers();
    } catch (error: any) {
      alert(error.response?.data?.error || "Error saving user");
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
      role: user.role.name,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm("Delete this user?")) {
      await usersAPI.delete(id);
      loadUsers();
    }
  };

  const columns = [
    { field: "username", headerName: "Username", flex: 1 },
    { field: "email", headerName: "Email", flex: 1 },
    { field: "firstName", headerName: "First Name", width: 130 },
    { field: "lastName", headerName: "Last Name", width: 130 },
    {
      field: "role",
      headerName: "Role",
      width: 150,
      renderCell: (params: any) => (
        <Chip label={params.value?.name} size="small" color="primary" variant="outlined" />
      ),
    },
    {
      field: "isActive",
      headerName: "Status",
      width: 100,
      renderCell: (params: any) => (
        <Chip
          label={params.value ? "Active" : "Inactive"}
          color={params.value ? "success" : "error"}
          size="small"
        />
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 100,
      renderCell: (params: any) => (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => handleEdit(params.row)}>
              <Edit />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => handleDelete(params.row.id)}>
              <Delete />
            </IconButton>
          </Tooltip>
        </>
      ),
    },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Users
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => {
            setEditingUser(null);
            setFormData({ email: "", username: "", password: "", firstName: "", lastName: "", role: "OPERATOR" });
            setDialogOpen(true);
          }}
        >
          Add User
        </Button>
      </Box>
      <Box sx={{ height: 600, width: "100%" }}>
        <DataGrid
          rows={users}
          columns={columns}
          loading={loading}
          paginationMode="server"
          rowCount={pagination.total}
          page={pagination.page - 1}
          pageSize={20}
          onPageModelChange={(model) => loadUsers(model.page + 1)}
          disableColumnFilter
          disableRowSelectionOnClick
        />
      </Box>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingUser ? "Edit User" : "Create User"}</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} sx={{ mt: 1, mb: 2 }} />
          {!editingUser && (
            <TextField fullWidth label="Username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} sx={{ mb: 2 }} />
          )}
          {!editingUser && (
            <TextField fullWidth label="Password" type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} sx={{ mb: 2 }} />
          )}
          <TextField fullWidth label="First Name" value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} sx={{ mb: 2 }} />
          <TextField fullWidth label="Last Name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} sx={{ mb: 2 }} />
          <TextField fullWidth select label="Role" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
            <MenuItem value="SUPER_ADMIN">Super Admin</MenuItem>
            <MenuItem value="ADMIN">Admin</MenuItem>
            <MenuItem value="OPERATOR">Operator</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>{editingUser ? "Save" : "Create"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
