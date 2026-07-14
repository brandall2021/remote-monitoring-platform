import { useState, useEffect } from "react";
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Chip,
  LinearProgress,
} from "@mui/material";
import {
  Computer,
  CheckCircle,
  Cancel,
  CameraAlt,
  Terminal,
} from "@mui/icons-material";
import { devicesAPI } from "../services/api";
import { DeviceStats } from "../types";

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card>
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
            <Typography variant="h3" fontWeight="bold">
              {value}
            </Typography>
          </Box>
          <Box sx={{ color, fontSize: 48 }}>{icon}</Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    devicesAPI.stats().then((res) => {
      setStats(res.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <LinearProgress />;

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>
        Dashboard
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Devices"
            value={stats?.total || 0}
            icon={<Computer />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Online"
            value={stats?.online || 0}
            icon={<CheckCircle />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Offline"
            value={stats?.offline || 0}
            icon={<Cancel />}
            color="error.main"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Commands (24h)"
            value={stats?.recentCommands || 0}
            icon={<Terminal />}
            color="warning.main"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
