import { Box, Typography } from "@mui/material";
import { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
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
          backgroundColor: "rgba(34, 197, 94, 0.08)",
          color: "primary.main",
          display: "flex",
          "& svg": { fontSize: 32 },
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6" sx={{ mb: 0.5, color: "text.primary" }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 360 }}>
          {description}
        </Typography>
      )}
      {action && <Box>{action}</Box>}
    </Box>
  );
}
