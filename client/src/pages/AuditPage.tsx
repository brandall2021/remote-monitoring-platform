import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  Typography,
  TextField,
  Grid,
  Card,
  CardContent,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Refresh, Search, Assessment } from "@mui/icons-material";
import { auditAPI, AuditLog } from "../services/api";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 50 });
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    action: "",
    resource: "",
    startDate: "",
    endDate: "",
  });

  const loadLogs = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await auditAPI.list(page, 50, filters);
      setLogs(data.logs);
      setTotal(data.total);
      setPaginationModel((prev) => ({ ...prev, page: page - 1 }));
    } catch {
      setError("Error al cargar los registros de auditoría.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs();
  }, []);

  const actionMeta = (action: string) => {
    if (action === "DEVICE_ON") return { label: "Equipo encendido", color: "#16a34a", bg: "rgba(34, 197, 94, 0.1)" };
    if (action === "DEVICE_OFF") return { label: "Equipo apagado", color: "#dc2626", bg: "rgba(239, 68, 68, 0.1)" };
    return { label: action, color: "secondary.main", bg: "rgba(59, 130, 246, 0.1)" };
  };

  const columns: GridColDef[] = [
    {
      field: "createdAt",
      headerName: "Fecha",
      type: "string",
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2" color="text.secondary">
          {new Date(params.value).toLocaleString()}
        </Typography>
      ),
    },
    {
      field: "user",
      headerName: "Usuario",
      type: "string",
      width: 150,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {params.value?.username || "Sistema"}
        </Typography>
      ),
    },
    {
      field: "action",
      headerName: "Acción",
      type: "string",
      width: 160,
      renderCell: (params) => {
        const meta = actionMeta(params.value as string);
        return (
          <Typography
            variant="caption"
            sx={{
              px: 1,
              py: 0.5,
              borderRadius: 1,
              fontWeight: 500,
              backgroundColor: meta.bg,
              color: meta.color,
            }}
          >
            {meta.label}
          </Typography>
        );
      },
    },
    {
      field: "resource",
      headerName: "Recurso",
      type: "string",
      width: 130,
      renderCell: (params) => (
        <Typography variant="body2">{params.value}</Typography>
      ),
    },
    {
      field: "resourceId",
      headerName: "ID del Recurso",
      type: "string",
      width: 120,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: '"Geist Mono", monospace', fontSize: "0.8125rem" }} color="text.secondary">
          {params.value ? params.value.slice(0, 8) + "..." : "-"}
        </Typography>
      ),
    },
    {
      field: "details",
      headerName: "Detalles",
      type: "string",
      width: 220,
      renderCell: (params: { value?: { hostname?: string; reason?: string } }) => {
        const details = params.value;
        return (
          <Typography variant="body2" color="text.secondary" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {details?.hostname
              ? `${details.hostname}${details.reason ? ` · ${details.reason}` : ""}`
              : "-"}
          </Typography>
        );
      },
    },
    {
      field: "ipAddress",
      headerName: "Dirección IP",
      type: "string",
      width: 140,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: '"Geist Mono", monospace', fontSize: "0.8125rem" }} color="text.secondary">
          {params.value || "-"}
        </Typography>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Registro de Auditoría"
        description="Seguimiento de todas las acciones y cambios del sistema"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => loadLogs()}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Actualizar
          </Button>
        }
      />

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Acción"
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Recurso"
                value={filters.resource}
                onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Fecha Inicio"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Fecha Fin"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Button fullWidth variant="contained" startIcon={<Search />} onClick={() => loadLogs()}>
                Buscar
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {error && <ErrorState message={error} onRetry={() => loadLogs()} />}

      {!error && logs.length === 0 && !loading ? (
        <EmptyState
          icon={<Assessment />}
          title="Sin registros de auditoría"
          description="Las acciones realizadas en el sistema aparecerán aquí."
        />
      ) : (
        <Box sx={{ height: 600, width: "100%" }}>
          <DataGrid
            rows={logs}
            columns={columns}
            loading={loading}
            paginationMode="server"
            rowCount={total}
            paginationModel={paginationModel}
            onPaginationModelChange={(model) => {
              setPaginationModel(model);
              loadLogs(model.page + 1);
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
    </Box>
  );
}
