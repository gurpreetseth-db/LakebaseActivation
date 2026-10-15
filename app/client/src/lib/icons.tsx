import {
  Layers,
  Database,
  Code,
  ArrowLeftRight,
  Gauge,
  Sparkles,
  Shield,
  Lock,
  Lightbulb,
  CheckCircle,
  Wrench,
  Map as MapIcon,
  AlertTriangle,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';

// Maps the icon strings used in app.config.json to concrete lucide icons.
const ICONS: Record<string, LucideIcon> = {
  layers: Layers,
  database: Database,
  code: Code,
  'arrow-left-right': ArrowLeftRight,
  gauge: Gauge,
  sparkles: Sparkles,
  shield: Shield,
  lock: Lock,
  lightbulb: Lightbulb,
  'check-circle': CheckCircle,
  wrench: Wrench,
  map: MapIcon,
  'alert-triangle': AlertTriangle,
};

export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? BookOpen;
  return <Icon className={className} />;
}
