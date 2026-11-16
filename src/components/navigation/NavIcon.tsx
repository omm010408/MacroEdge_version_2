import {
  Activity,
  Award,
  BarChart3,
  Bookmark,
  BrainCircuit,
  Briefcase,
  Building2,
  CheckSquare,
  Crosshair,
  Flame,
  GitCompare,
  Globe,
  GraduationCap,
  Grid3x3,
  Landmark,
  LayoutDashboard,
  LineChart,
  Percent,
  ShieldAlert,
  Trophy,
  Users,
} from "lucide-react";
import type { NavIconKey } from "@/config/navigation";

export function NavIcon({
  name,
  className = "h-4 w-4",
}: {
  name: NavIconKey;
  className?: string;
}) {
  switch (name) {
    case "layout-dashboard":
      return <LayoutDashboard className={className} />;
    case "graduation-cap":
      return <GraduationCap className={className} />;
    case "award":
      return <Award className={className} />;
    case "trophy":
      return <Trophy className={className} />;
    case "users":
      return <Users className={className} />;
    case "activity":
      return <Activity className={className} />;
    case "briefcase":
      return <Briefcase className={className} />;
    case "crosshair":
      return <Crosshair className={className} />;
    case "grid-3x3":
      return <Grid3x3 className={className} />;
    case "landmark":
      return <Landmark className={className} />;
    case "building-2":
      return <Building2 className={className} />;
    case "shield-alert":
      return <ShieldAlert className={className} />;
    case "line-chart":
      return <LineChart className={className} />;
    case "flame":
      return <Flame className={className} />;
    case "percent":
      return <Percent className={className} />;
    case "globe":
      return <Globe className={className} />;
    case "bar-chart-3":
      return <BarChart3 className={className} />;
    case "git-compare":
      return <GitCompare className={className} />;
    case "bookmark":
      return <Bookmark className={className} />;
    case "check-square":
      return <CheckSquare className={className} />;
    case "brain-circuit":
      return <BrainCircuit className={className} />;
    default:
      return <Activity className={className} />;
  }
}
