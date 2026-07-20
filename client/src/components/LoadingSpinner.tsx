import { Box, CircularProgress, Typography } from "@mui/material";

interface LoadingSpinnerProps {
  message?: string;
  fullScreen?: boolean;
}

export default function LoadingSpinner({ message = "Loading...", fullScreen = false }: LoadingSpinnerProps) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        p: 4,
        ...(fullScreen && {
          position: "fixed",
          inset: 0,
          backgroundColor: "background.default",
          zIndex: 9999,
        }),
      }}
    >
      <CircularProgress size={32} sx={{ color: "primary.main" }} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
