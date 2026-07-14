import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Button,
  DataGrid,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import { Refresh, Visibility, Delete, Computer } from "@mui/icons-material";
import { devicesAPI } from "../services/api";
import { Device } from "../types";

export default function DevicesPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });

  const loadDevices = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await devicesAPI.list(page);
      setDevices(data.devices);
      setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const columns = [
    {
      field: "hostname",
      headerName: "Hostname",
      flex: 1,
      renderCell: (params: any) => (
        <Typography fontWeight="bold">{params.value}</Typography>
      ),
    },
    {
      field: "status",
      headerName: "Status",
      width: 120,
      renderCell: (params: any) => (
        <Chip
          label={params.value}
          color={params.value === "ONLINE" ? "success" : "error"}
          size="small"
          variant="outlined"
        />
      ),
    },
    { field: "operatingSystem", headerName: "OS", width: 150 },
    { field: "ipAddress", headerName: "IP Address", width: 150 },
    {
      field: "agentVersion",
      headerName: "Agent",
      width: 100,
      renderCell: (params: any) => params.value || "-",
    },
    {
      field: "lastSeenAt",
      headerName: "Last Seen",
      width: 180,
      renderCell: (params: any) =>
        params.value ? new Date(params.value).toLocaleString() : "Never",
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 120,
      renderCell: (params: any) => (
        <>
          <Tooltip title="View Details">
            <IconButton
              size="small"
              onClick={() => navigate(`/devices/${params.row.id}`)}
            >
              <Visibility />
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
          Devices
        </Typography>
        <Button
          variant="outlined"
          startIcon={<Refresh />}
          onClick={() => loadDevices()}
        >
          Refresh
        </Button>
      </Box>
      {loading && <LinearProgress />}
      <Box sx={{ height: 600, width: "100%" }}>
        <DataGrid
          rows={devices}
          columns={columns}
          loading={loading}
          paginationMode="server"
          rowCount={pagination.total}
          page={pagination.page - 1}
          pageSize={20}
          onPageModelChange={(model) => loadDevices(model.page + 1)}
          disableColumnFilter
          disableRowSelectionOnClick
        />
      </Box>
    </Box>
  );
}
