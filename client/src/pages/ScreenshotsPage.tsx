import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Button,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  CircularProgress,
} from "@mui/material";
import { DataGrid, GridColDef } from "@mui/x-data-grid";
import { Refresh, Visibility, Close, Download, CameraAlt } from "@mui/icons-material";
import { screenshotsAPI, Screenshot } from "../services/api";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

export default function ScreenshotsPage() {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const [previewDialog, setPreviewDialog] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<Screenshot | null>(null);
  const [imageLoading, setImageLoading] = useState(false);

  const loadScreenshots = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await screenshotsAPI.list(page);
      setScreenshots(data.screenshots);
      setTotal(data.total);
      setPaginationModel((prev) => ({ ...prev, page: page - 1 }));
    } catch {
      setError("Failed to load screenshots.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreenshots();
  }, [loadScreenshots]);

  const getScreenshotUrl = (filePath: string) => {
    const filename = filePath.split("/").pop();
    return `/uploads/screenshots/${filename}`;
  };

  const columns: GridColDef[] = [
    {
      field: "device",
      headerName: "Device",
      type: "string",
      flex: 1,
      minWidth: 150,
      renderCell: (params: { value?: { hostname: string } }) => (
        <Typography sx={{ fontWeight: 500, fontSize: "0.875rem" }}>
          {params.value?.hostname || "-"}
        </Typography>
      ),
    },
    {
      field: "requestedBy",
      headerName: "Requested By",
      type: "string",
      width: 150,
      renderCell: (params: { value?: { username: string } }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value?.username || "-"}
        </Typography>
      ),
    },
    {
      field: "fileSize",
      headerName: "Size",
      type: "string",
      width: 100,
      renderCell: (params: { value?: number }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value ? `${(params.value / 1024).toFixed(1)} KB` : "-"}
        </Typography>
      ),
    },
    {
      field: "width",
      headerName: "Resolution",
      type: "string",
      width: 130,
      renderCell: (params: { value?: number; row: Screenshot }) => (
        <Typography variant="body2" color="text.secondary">
          {params.value && params.row.height ? `${params.value}x${params.row.height}` : "-"}
        </Typography>
      ),
    },
    {
      field: "createdAt",
      headerName: "Date",
      type: "string",
      width: 170,
      renderCell: (params) => (
        <Typography variant="body2" color="text.secondary">
          {new Date(params.value).toLocaleString()}
        </Typography>
      ),
    },
    {
      field: "actions",
      headerName: "",
      type: "string",
      width: 56,
      sortable: false,
      renderCell: (params: { row: Screenshot }) => (
        <IconButton
          size="small"
          onClick={() => {
            setSelectedScreenshot(params.row);
            setPreviewDialog(true);
            setImageLoading(true);
          }}
          aria-label="View screenshot"
        >
          <Visibility fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Box>
      <PageHeader
        title="Screenshots"
        description="View captured screenshots from monitored devices"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={() => loadScreenshots()}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Refresh
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => loadScreenshots()} />}

      {!error && screenshots.length === 0 && !loading ? (
        <EmptyState
          icon={<CameraAlt />}
          title="No screenshots yet"
          description="Request screenshots from device detail pages to see them here."
        />
      ) : (
        <Box sx={{ height: 600, width: "100%" }}>
          <DataGrid
            rows={screenshots}
            columns={columns}
            loading={loading}
            paginationMode="server"
            rowCount={total}
            paginationModel={paginationModel}
            onPaginationModelChange={(model) => {
              setPaginationModel(model);
              loadScreenshots(model.page + 1);
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

      <Dialog
        open={previewDialog}
        onClose={() => {
          setPreviewDialog(false);
          setSelectedScreenshot(null);
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 600 }}>
          Screenshot Preview
          <Box>
            {selectedScreenshot && (
              <IconButton
                onClick={() => {
                  const url = getScreenshotUrl(selectedScreenshot.filePath);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `screenshot-${selectedScreenshot.id.slice(0, 8)}.png`;
                  a.click();
                }}
                aria-label="Download screenshot"
                sx={{ mr: 1 }}
              >
                <Download />
              </IconButton>
            )}
            <IconButton
              onClick={() => {
                setPreviewDialog(false);
                setSelectedScreenshot(null);
              }}
              aria-label="Close preview"
            >
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedScreenshot && (
            <Box sx={{ textAlign: "center" }}>
              {imageLoading && (
                <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
                  <CircularProgress size={32} sx={{ color: "primary.main" }} />
                </Box>
              )}
              <img
                src={getScreenshotUrl(selectedScreenshot.filePath)}
                alt={`Screenshot from ${selectedScreenshot.device?.hostname || "device"} at ${new Date(selectedScreenshot.createdAt).toLocaleString()}`}
                style={{
                  maxWidth: "100%",
                  borderRadius: 8,
                  display: imageLoading ? "none" : "block",
                }}
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {selectedScreenshot.device?.hostname} - {new Date(selectedScreenshot.createdAt).toLocaleString()}
              </Typography>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
