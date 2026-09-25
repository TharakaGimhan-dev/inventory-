// download.ts saves a file the API returned.
//
// fetch, not a plain link: the API needs the auth cookie and answers 402 for a
// feature the plan does not include. A link would navigate the whole tab to a
// JSON error page.
import { ApiError } from './api';

export async function download(
  path: string,
  filename: string,
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      (body as { message?: string })?.message ?? 'Could not prepare that file',
      body,
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Released on the next tick: revoking it immediately cancels the download in
  // some browsers before it has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
