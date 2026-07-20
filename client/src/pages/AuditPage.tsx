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
      setError("Failed to load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs();
  }, []);

  const columns: GridColDef[] = [
    {
      field: "createdAt",
      headerName: "Date",
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
      headerName: "User",
      type: "string",
      width: 150,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {params.value?.username || "System"}
        </Typography>
      ),
    },
    {
      field: "action",
      headerName: "Action",
      type: "string",
      width: 130,
      renderCell: (params) => (
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
          {params.value}
        </Typography>
      ),
    },
    {
      field: "resource",
      headerName: "Resource",
      type: "string",
      width: 130,
      renderCell: (params) => (
        <Typography variant="body2">{params.value}</Typography>
      ),
    },
    {
      field: "resourceId",
      headerName: "Resource ID",
      type: "string",
      width: 120,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ fontFamily: '"Geist Mono", monospace', fontSize: "0.8125rem" }} color="text.secondary">
          {params.value ? params.value.slice(0, 8) + "..." : "-"}
        </Typography>
      ),
    },
    {
      field: "ipAddress",
      headerName: "IP Address",
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
        title="Audit Log"
        description="Track all system actions and changes"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => loadLogs()}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Refresh
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
                label="Action"
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Resource"
                value={filters.resource}
                onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2.5}>
              <TextField
                fullWidth
                size="small"
                label="Start Date"
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
                label="End Date"
                type="date"
                InputLabelProps={{ shrink: true }}
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={2}>
              <Button fullWidth variant="contained" startIcon={<Search />} onClick={() => loadLogs()}>
                Search
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {error && <ErrorState message={error} onRetry={() => loadLogs()} />}

      {!error && logs.length === 0 && !loading ? (
        <EmptyState
          icon={<Assessment />}
          title="No audit logs"
          description="Actions performed in the system will appear here."
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
