const form = document.getElementById('demo-form');
const dateInput = document.getElementById('date-input');
const slotSelect = document.getElementById('slot-select');
const statusEl = document.getElementById('status');

function formatSlot(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function loadAvailability(dateValue) {
  if (!dateValue) return;

  slotSelect.innerHTML = '<option value="">Loading...</option>';

  try {
    const response = await fetch(`/api/availability?date=${dateValue}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Could not load availability.');
    }

    slotSelect.innerHTML = '';

    if (data.slots.length === 0) {
      slotSelect.innerHTML = '<option value="">No slots available for this date</option>';
      return;
    }

    slotSelect.innerHTML = '<option value="">Select a time</option>';
    data.slots.forEach((slot) => {
      const option = document.createElement('option');
      option.value = slot.start;
      option.textContent = `${formatSlot(slot.start)} - ${formatSlot(slot.end)}`;
      slotSelect.appendChild(option);
    });
  } catch (error) {
    slotSelect.innerHTML = '<option value="">Could not load slots</option>';
    statusEl.textContent = error.message;
  }
}

dateInput.addEventListener('change', () => {
  statusEl.textContent = '';
  loadAvailability(dateInput.value);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!slotSelect.value) {
    statusEl.textContent = 'Please select an available time slot.';
    return;
  }

  statusEl.textContent = 'Booking your demo...';

  const formData = new FormData(form);
  const payload = {
    businessName: formData.get('businessName'),
    contactName: formData.get('contactName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    demoDateTime: slotSelect.value,
  };

  try {
    const response = await fetch('/api/book-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Booking failed.');
    }

    statusEl.textContent =
      'Done! Confirmation email sent. You will also receive a reminder 1 hour before the demo.';
    form.reset();
    slotSelect.innerHTML = '<option value="">Select a date first</option>';
  } catch (error) {
    statusEl.textContent = error.message;
  }
});
