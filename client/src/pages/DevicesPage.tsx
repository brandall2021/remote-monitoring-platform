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
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Refresh, Visibility, Search, Computer } from "@mui/icons-material";
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

  const loadDevices = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await devicesAPI.list(page);
      setDevices(data.devices);
      setTotal(data.total);
      setPaginationModel((prev) => ({ ...prev, page: page - 1 }));
    } catch {
      setError("Failed to load devices. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

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
      headerName: "Status",
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
      headerName: "IP Address",
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
      headerName: "Agent",
      type: "string",
      width: 100,
      renderCell: (params: { value?: string }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value || "-"}
        </Typography>
      ),
    },
    {
      field: "lastSeenAt",
      headerName: "Last Seen",
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
      width: 56,
      sortable: false,
      renderCell: (params: { row: Device }) => (
        <Tooltip title="View details">
          <IconButton
            size="small"
            onClick={() => navigate(`/devices/${params.row.id}`)}
            aria-label={`View details for ${params.row.hostname}`}
          >
            <Visibility fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Devices"
        description="Manage and monitor your corporate devices"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => loadDevices(paginationModel.page + 1)}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Refresh
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => loadDevices()} />}

      {!error && devices.length === 0 && !loading ? (
        <EmptyState
          icon={<Computer />}
          title="No devices registered"
          description="Deploy agents to your corporate devices to start monitoring."
        />
      ) : (
        <>
          <Box sx={{ mb: 2 }}>
            <TextField
              size="small"
              placeholder="Search by hostname, IP, or OS..."
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
    </Box>
  );
}
