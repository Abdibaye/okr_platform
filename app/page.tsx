import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
export default function Page() {
  return <main className="mx-auto max-w-2xl p-6 pt-24"><Card><CardHeader><CardTitle>Your app is ready</CardTitle><CardDescription>Tell Neander what you want to make.</CardDescription></CardHeader><CardContent><Button asChild><a href="/api/health">Check the API</a></Button></CardContent></Card></main>;
}
