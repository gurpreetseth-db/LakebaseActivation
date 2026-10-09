import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@databricks/appkit-ui/react';
import { useAppData } from '@/lib/AppData';
import type { Partner } from '@/lib/types';

export function Onboarding() {
  const { config, setPartner } = useAppData();
  const { onboarding, branding } = config;
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const missingRequired = onboarding.fields.some((f) => f.required && !values[f.key]?.trim());

  const submit = () => {
    setTouched(true);
    if (missingRequired) return;
    const partner: Partner = {
      name: values.name?.trim() ?? '',
      email: values.email?.trim() ?? '',
      org: values.org?.trim() ?? '',
    };
    setPartner(partner);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{branding.appName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{branding.tagline}</p>
        </div>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{onboarding.heading}</CardTitle>
            <CardDescription>{onboarding.subheading}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {onboarding.fields.map((field) => {
              const showError = touched && field.required && !values[field.key]?.trim();
              return (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  <Input
                    id={field.key}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    aria-invalid={showError}
                  />
                  {showError ? <p className="text-xs text-destructive">{field.label} is required.</p> : null}
                </div>
              );
            })}
            <Button className="w-full" onClick={submit} disabled={touched && missingRequired}>
              Start learning
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Your details stay in this browser and personalize your adoption plan.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
