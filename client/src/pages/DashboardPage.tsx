import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Button,
} from "@mui/material";
import { Computer, CheckCircle, Cancel, Refresh } from "@mui/icons-material";
import { devicesAPI, DeviceStats } from "../services/api";
import PageHeader from "../components/PageHeader";
import AnimatedCounter from "../components/AnimatedCounter";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

function StatCard({
  title,
  value,
  icon,
  color,
  delay,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  delay: number;
}) {
  return (
    <Card
      sx={{
        animation: `fadeIn 0.4s ease-out ${delay}ms both`,
        "@keyframes fadeIn": {
          from: { opacity: 0, transform: "translateY(12px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontWeight: 500 }}>
              {title}
            </Typography>
            <AnimatedCounter
              value={value}
              typographyProps={{
                variant: "h3",
                sx: { fontWeight: 700, color: "text.primary" },
              }}
            />
          </Box>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2.5,
              backgroundColor: `${color}10`,
              color: color,
              display: "flex",
              "& svg": { fontSize: 24 },
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DeviceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await devicesAPI.stats();
      setStats(data);
    } catch (err) {
      setError("Error al cargar las estadísticas del panel. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress size={32} sx={{ color: "primary.main" }} />
      </Box>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadStats} />;
  }

  if (!stats || (stats.total === 0)) {
    return (
      <>
        <PageHeader title="Panel" description="Resumen de tus dispositivos monitoreados" />
        <EmptyState
          icon={<Computer />}
          title="Aún no hay dispositivos"
          description="Comienza a monitorear implementando agentes en tus dispositivos corporativos."
        />
      </>
    );
  }

  return (
    <Box>
      <PageHeader
        title="Panel"
        description="Resumen de tus dispositivos monitoreados"
        action={
          <Button
            variant="outlined"
            startIcon={<Refresh />}
            onClick={loadStats}
            sx={{ borderColor: "divider", color: "text.secondary" }}
          >
            Actualizar
          </Button>
        }
      />

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="Total de Dispositivos"
            value={stats.total}
            icon={<Computer />}
            color="#3B82F6"
            delay={0}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="En línea"
            value={stats.online}
            icon={<CheckCircle />}
            color="#22C55E"
            delay={80}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatCard
            title="Desconectados"
            value={stats.offline}
            icon={<Cancel />}
            color="#EF4444"
            delay={160}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
