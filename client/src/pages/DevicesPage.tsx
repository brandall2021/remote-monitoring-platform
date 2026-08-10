import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Refresh, Visibility, Search, Computer, Delete } from "@mui/icons-material";
import { devicesAPI, Device } from "../services/api";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";
import StatusBadge from "../components/StatusBadge";

export default function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const loadDevices = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await devicesAPI.list(page);
      setDevices(data.devices);
      setTotal(data.total);
      setPaginationModel((prev) => ({ ...prev, page: page - 1 }));
    } catch {
      setError("Error al cargar los dispositivos. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDelete = async () => {
    if (!deletingDevice) return;
    setDeleting(true);
    try {
      await devicesAPI.delete(deletingDevice.id);
      setSnackbar({ open: true, message: "Dispositivo eliminado correctamente", severity: "success" });
      setDeleteDialogOpen(false);
      loadDevices(paginationModel.page + 1);
    } catch {
      setSnackbar({ open: true, message: "Error al eliminar el dispositivo", severity: "error" });
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const filteredDevices = devices.filter(
    (d) =>
      d.hostname.toLowerCase().includes(search.toLowerCase()) ||
      d.ipAddress.includes(search) ||
      d.operatingSystem.toLowerCase().includes(search.toLowerCase())
  );

  const columns: GridColDef[] = [
    {
      field: "hostname",
      headerName: "Hostname",
      type: "string",
      flex: 1,
      minWidth: 150,
      renderCell: (params) => (
        <Typography sx={{ fontWeight: 600, fontSize: "0.875rem" }}>{params.value}</Typography>
      ),
    },
    {
      field: "status",
      headerName: "Estado",
      type: "string",
      width: 120,
      renderCell: (params) => (
        <StatusBadge status={(params.value || "OFFLINE").toLowerCase() as "online" | "offline"} />
      ),
    },
    {
      field: "operatingSystem",
      headerName: "OS",
      type: "string",
      width: 140,
      renderCell: (params: { row: Device }) => (
        <Typography variant="body2" color="text.secondary">
          {params.row.operatingSystem} {params.row.osVersion || ""}
        </Typography>
      ),
    },
    {
      field: "ipAddress",
      headerName: "Dirección IP",
      type: "string",
      width: 140,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: '"Geist Mono", monospace', fontSize: "0.8125rem" }}>
          {params.value}
        </Typography>
      ),
    },
    {
      field: "agentVersion",
      headerName: "Agente",
      type: "string",
      width: 100,
      renderCell: (params: { value?: string }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value || "-"}
        </Typography>
      ),
    },
    {
      field: "role",
      headerName: "Rol",
      type: "string",
      width: 120,
      renderCell: (params: { value?: string }) => (
        <Typography
          variant="caption"
          sx={{
            px: 1,
            py: 0.5,
            borderRadius: 1,
            fontWeight: 500,
            backgroundColor:
              params.value === "SUPERVISOR"
                ? "rgba(59, 130, 246, 0.1)"
                : "rgba(139, 92, 246, 0.1)",
            color:
              params.value === "SUPERVISOR"
                ? "secondary.main"
                : "#8b5cf6",
          }}
        >
          {params.value === "SUPERVISOR" ? "Supervisor" : "Asesor"}
        </Typography>
      ),
    },
    {
      field: "lastSeenAt",
      headerName: "Última Conexión",
      type: "string",
      width: 170,
      renderCell: (params: { value?: string }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value ? new Date(params.value).toLocaleString() : "Never"}
        </Typography>
      ),
    },
    {
      field: "actions",
      headerName: "",
      type: "string",
      width: 96,
      sortable: false,
      renderCell: (params: { row: Device }) => (
        <>
          <Tooltip title="Ver detalles">
            <IconButton
              size="small"
              onClick={() => navigate(`/devices/${params.row.id}`)}
              aria-label={`View details for ${params.row.hostname}`}
            >
              <Visibility fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Eliminar dispositivo">
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                setDeletingDevice(params.row);
                setDeleteDialogOpen(true);
              }}
              aria-label={`Delete ${params.row.hostname}`}
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
        title="Dispositivos"
        description="Gestiona y monitorea tus dispositivos corporativos"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => loadDevices(paginationModel.page + 1)}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Actualizar
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => loadDevices()} />}

      {!error && devices.length === 0 && !loading ? (
        <EmptyState
          icon={<Computer />}
          title="No hay dispositivos registrados"
          description="Implementa agentes en tus dispositivos corporativos para comenzar a monitorear."
        />
      ) : (
        <>
          <Box sx={{ mb: 2 }}>
            <TextField
              size="small"
              placeholder="Buscar por hostname, IP o sistema operativo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 300 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" sx={{ color: "text.secondary" }} />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          <Box sx={{ height: 600, width: "100%" }}>
            <DataGrid
              rows={filteredDevices}
              columns={columns}
              loading={loading}
              paginationMode="server"
              rowCount={total}
              paginationModel={paginationModel}
              onPaginationModelChange={(model) => {
                setPaginationModel(model);
                loadDevices(model.page + 1);
              }}
              disableColumnFilter
              disableRowSelectionOnClick
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                "& .MuiDataGrid-cell": {
                  borderColor: "divider",
                },
                "& .MuiDataGrid-columnHeaders": {
                  backgroundColor: "rgba(30, 41, 59, 0.5)",
                },
              }}
            />
          </Box>
        </>
      )}

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 600 }}>Eliminar Dispositivo</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            ¿Estás seguro de que deseas eliminar el dispositivo{" "}
            <strong>{deletingDevice?.hostname}</strong> ({deletingDevice?.ipAddress})? Esta acción no se puede
            deshacer.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} sx={{ color: "text.secondary" }}>
            Cancelar
          </Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Eliminando..." : "Eliminar"}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
