import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  DataGrid,
  Chip,
  LinearProgress,
  TextField,
  Grid,
} from "@mui/material";
import { Refresh, Search } from "@mui/icons-material";
import { auditAPI } from "../services/api";
import { AuditLog } from "../types";

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [filters, setFilters] = useState({
    action: "",
    resource: "",
    startDate: "",
    endDate: "",
  });

  const loadLogs = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await auditAPI.list(page, 50, filters);
      setLogs(data.logs);
      setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const columns = [
    {
      field: "createdAt",
      headerName: "Date",
      width: 180,
      renderCell: (params: any) => new Date(params.value).toLocaleString(),
    },
    {
      field: "user",
      headerName: "User",
      width: 150,
      renderCell: (params: any) => params.value?.username || "System",
    },
    {
      field: "action",
      headerName: "Action",
      width: 130,
      renderCell: (params: any) => <Chip label={params.value} size="small" variant="outlined" />,
    },
    {
      field: "resource",
      headerName: "Resource",
      width: 130,
      renderCell: (params: any) => params.value,
    },
    {
      field: "resourceId",
      headerName: "Resource ID",
      width: 120,
      renderCell: (params: any) =>
        params.value ? params.value.slice(0, 8) + "..." : "-",
    },
    {
      field: "ipAddress",
      headerName: "IP Address",
      width: 140,
      renderCell: (params: any) => params.value || "-",
    },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Audit Log
        </Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => loadLogs()}>
          Refresh
        </Button>
      </Box>

      <Card sx={{ mb: 3, p: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={3}>
            <TextField
              fullWidth
              size="small"
              label="Action"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField
              fullWidth
              size="small"
              label="Resource"
              value={filters.resource}
              onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={3}>
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
          <Grid item xs={12} sm={3}>
            <Button fullWidth variant="contained" startIcon={<Search />} onClick={() => loadLogs()}>
              Search
            </Button>
          </Grid>
        </Grid>
      </Card>

      <Box sx={{ height: 600, width: "100%" }}>
        <DataGrid
          rows={logs}
          columns={columns}
          loading={loading}
          paginationMode="server"
          rowCount={pagination.total}
          page={pagination.page - 1}
          pageSize={50}
          onPageModelChange={(model) => loadLogs(model.page + 1)}
          disableColumnFilter
          disableRowSelectionOnClick
        />
      </Box>
    </Box>
  );
}

function Card(props: any) {
  return (
    <Box
      sx={{
        backgroundColor: "background.paper",
        borderRadius: 1,
        border: "1px solid rgba(255,255,255,0.08)",
        ...props.sx,
      }}
    >
      {props.children}
    </Box>
  );
}
