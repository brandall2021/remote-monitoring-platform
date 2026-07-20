import { Box, Typography } from "@mui/material";

interface StatusBadgeProps {
  status: "online" | "offline";
  label?: string;
  size?: "small" | "medium";
}

export default function StatusBadge({ status, label, size = "small" }: StatusBadgeProps) {
  const isOnline = status === "online";
  const dotSize = size === "small" ? 8 : 10;
  const fontSize = size === "small" ? "0.8125rem" : "0.875rem";

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
      <Box
        sx={{
          width: dotSize,
          height: dotSize,
          borderRadius: "50%",
          backgroundColor: isOnline ? "success.main" : "text.disabled",
          boxShadow: isOnline ? "0 0 8px rgba(34, 197, 94, 0.4)" : "none",
          animation: isOnline ? "pulse 2s ease-in-out infinite" : "none",
        }}
      />
      <Typography variant="body2" sx={{ fontSize, color: isOnline ? "text.primary" : "text.secondary" }}>
        {label || (isOnline ? "Online" : "Offline")}
      </Typography>
    </Box>
  );
}
