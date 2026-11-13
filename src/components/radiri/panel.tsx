import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card size="sm" className={cn("gap-3", className)}>
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </div>
        {action ? <div className="justify-self-end">{action}</div> : null}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
