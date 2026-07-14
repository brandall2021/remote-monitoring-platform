import { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  DataGrid,
  Chip,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
} from "@mui/material";
import { Refresh, Visibility, Close } from "@mui/icons-material";
import { screenshotsAPI } from "../services/api";
import { Screenshot } from "../types";

export default function ScreenshotsPage() {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [previewDialog, setPreviewDialog] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);

  const loadScreenshots = async (page = 1) => {
    setLoading(true);
    try {
      const { data } = await screenshotsAPI.list(page);
      setScreenshots(data.screenshots);
      setPagination(data.pagination);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScreenshots();
  }, []);

  const columns = [
    {
      field: "device",
      headerName: "Device",
      flex: 1,
      renderCell: (params: any) => params.value?.hostname || "-",
    },
    {
      field: "requestedBy",
      headerName: "Requested By",
      width: 150,
      renderCell: (params: any) => params.value?.username || "-",
    },
    {
      field: "fileSize",
      headerName: "Size",
      width: 100,
      renderCell: (params: any) =>
        params.value ? `${(params.value / 1024).toFixed(1)} KB` : "-",
    },
    {
      field: "width",
      headerName: "Resolution",
      width: 150,
      renderCell: (params: any) =>
        params.value && params.row.height
          ? `${params.value}x${params.row.height}`
          : "-",
    },
    {
      field: "createdAt",
      headerName: "Date",
      width: 180,
      renderCell: (params: any) => new Date(params.value).toLocaleString(),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 80,
      renderCell: (params: any) => (
        <IconButton
          size="small"
          onClick={() => {
            setSelectedScreenshot(params.row);
            setPreviewDialog(true);
          }}
        >
          <Visibility />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          Screenshots
        </Typography>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => loadScreenshots()}>
          Refresh
        </Button>
      </Box>
      <Box sx={{ height: 600, width: "100%" }}>
        <DataGrid
          rows={screenshots}
          columns={columns}
          loading={loading}
          paginationMode="server"
          rowCount={pagination.total}
          page={pagination.page - 1}
          pageSize={20}
          onPageModelChange={(model) => loadScreenshots(model.page + 1)}
          disableColumnFilter
          disableRowSelectionOnClick
        />
      </Box>

      <Dialog
        open={previewDialog}
        onClose={() => setPreviewDialog(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between" }}>
          Screenshot Preview
          <IconButton onClick={() => setPreviewDialog(false)}>
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {selectedScreenshot && (
            <Box sx={{ textAlign: "center" }}>
              <img
                src={`/uploads/screenshots/${selectedScreenshot.filePath.split("/").pop()}`}
                alt="Screenshot"
                style={{ maxWidth: "100%", borderRadius: 8 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {selectedScreenshot.device?.hostname} -{" "}
                {new Date(selectedScreenshot.createdAt).toLocaleString()}
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
