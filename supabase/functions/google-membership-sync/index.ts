import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonResponse = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

const normalizeKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const secretsMatch = (provided: string, expected: string) => {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
};

const answerValue = (answers: Record<string, unknown>, test: (key: string) => boolean) => {
  const entry = Object.entries(answers).find(([key]) => test(normalizeKey(key)));
  if (!entry) return '';
  const value = Array.isArray(entry[1]) ? entry[1].join(', ') : entry[1];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
};

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const expectedSecret = Deno.env.get('UPSA_FORMS_WEBHOOK_SECRET');
  if (!expectedSecret || new TextEncoder().encode(expectedSecret).length < 32) {
    return jsonResponse(500, { error: 'Membership sync is not configured' });
  }
  const providedSecret = request.headers.get('x-upsa-webhook-secret');
  if (!providedSecret || !secretsMatch(providedSecret, expectedSecret)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const rawBody = await request.text();
  if (rawBody.length > 262144) {
    return jsonResponse(413, { error: 'Response payload is too large' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON payload' });
  }

  const submissionId = payload.external_submission_id;
  const sourceFormKey = payload.source_form_key;
  const answers = payload.answers;
  if (
    typeof submissionId !== 'string'
    || submissionId.length < 1
    || submissionId.length > 300
    || typeof sourceFormKey !== 'string'
    || sourceFormKey.length < 1
    || sourceFormKey.length > 100
    || !answers
    || typeof answers !== 'object'
    || Array.isArray(answers)
  ) {
    return jsonResponse(400, { error: 'Missing or invalid submission fields' });
  }

  const submittedAtValue = payload.submitted_at;
  const submittedAt = typeof submittedAtValue === 'string' && Number.isFinite(Date.parse(submittedAtValue))
    ? new Date(submittedAtValue).toISOString()
    : new Date().toISOString();
  const formAnswers = Object.fromEntries(
    Object.entries(answers as Record<string, unknown>)
      .filter(([key]) => !/(password|passcode|(^| )pin($| )|cvv|cvc|security code|card number|credit card|debit card|bank login|bank account|account number|routing number)/i.test(normalizeKey(key)))
  );
  const record = {
    external_submission_id: submissionId,
    source_form_key: sourceFormKey,
    submitted_at: submittedAt,
    applicant_name: answerValue(formAnswers, key =>
      /^(applicant |member |full |complete )?name$/.test(key)
    ).slice(0, 160),
    applicant_email: answerValue(formAnswers, key => key.includes('email')).slice(0, 320).toLowerCase(),
    applicant_phone: answerValue(formAnswers, key =>
      /phone|mobile|contact number/.test(key)
    ).slice(0, 80),
    application_type: answerValue(formAnswers, key =>
      /application type|registration type|new or renewal/.test(key)
    ).slice(0, 80),
    membership_plan: answerValue(formAnswers, key =>
      /membership plan|membership type|plan selected/.test(key)
    ).slice(0, 120),
    athlete_id: answerValue(formAnswers, key => key.includes('athlete id')).slice(0, 80),
    answers: formAnswers
  };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Membership sync storage is not configured' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error } = await supabase
    .from('membership_applications')
    .upsert(record, {
      onConflict: 'external_submission_id',
      ignoreDuplicates: true
    });

  if (error) {
    return jsonResponse(500, { error: 'Could not save membership application' });
  }
  return jsonResponse(200, { status: 'received' });
});
