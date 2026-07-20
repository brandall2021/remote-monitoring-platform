import { Box, Typography, Button } from "@mui/material";
import { Warning } from "@mui/icons-material";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        py: 8,
        px: 4,
        textAlign: "center",
      }}
    >
      <Box
        sx={{
          mb: 2,
          p: 2,
          borderRadius: 3,
          backgroundColor: "rgba(239, 68, 68, 0.08)",
          color: "error.main",
          display: "flex",
          "& svg": { fontSize: 32 },
        }}
      >
        <Warning />
      </Box>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 360 }}>
        {message}
      </Typography>
      {onRetry && (
        <Button variant="outlined" onClick={onRetry} sx={{ borderColor: "divider", color: "text.secondary" }}>
          Try again
        </Button>
      )}
    </Box>
  );
}
