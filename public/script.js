const form = document.getElementById('demo-form');
const statusText = document.getElementById('form-status');
document.getElementById('year').textContent = new Date().getFullYear();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusText.textContent = 'Submitting...';

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  if (payload.demoDateTime) {
    payload.demoDateTime = new Date(payload.demoDateTime).toISOString();
  }

  try {
    const response = await fetch('/api/book-demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      statusText.textContent = data.message || 'Something went wrong. Please try again.';
      return;
    }

    statusText.textContent =
      'Thanks! Your demo is booked. Check your inbox for confirmation and a reminder 1 hour before.';
    form.reset();
  } catch (error) {
    statusText.textContent = 'Network error. Please check your connection and try again.';
  }
});
