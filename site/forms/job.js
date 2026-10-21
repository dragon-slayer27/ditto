/* A React (controlled components) job application, like the big applicant-tracking portals. */
/* global React, ReactDOM */
(function () {
  const h = React.createElement;
  const { useState } = React;

  const COUNTRIES = ['Australia', 'Canada', 'France', 'Germany', 'India', 'Ireland', 'Japan', 'Netherlands', 'Singapore', 'United Arab Emirates', 'United Kingdom', 'United States'];
  const PHONE_CODES = ['+1 United States', '+44 United Kingdom', '+61 Australia', '+65 Singapore', '+91 India', '+971 United Arab Emirates'];

  function App() {
    const [v, setV] = useState({});
    const [review, setReview] = useState(null);
    const set = (name, value) => setV((s) => ({ ...s, [name]: value }));
    const text = (name, type) => ({ id: name, name, type: type || 'text', value: v[name] || '', onChange: (e) => set(name, e.target.value) });
    const sel = (name) => ({ id: name, name, value: v[name] || '', onChange: (e) => set(name, e.target.value) });
    const opts = (list, placeholder) => [h('option', { key: '_', value: '' }, placeholder || 'Select one')].concat(list.map((o) => h('option', { key: o, value: o }, o)));
    const radio = (name, value) => h('label', { key: value }, h('input', { type: 'radio', name, value, checked: v[name] === value, onChange: () => set(name, value) }), ` ${value}`);
    const field = (id, label, control, wide) => h('div', { className: `field${wide ? ' wide' : ''}` }, h('label', { htmlFor: id }, label), control);

    return h(
      'form',
      {
        onSubmit: (e) => {
          e.preventDefault();
          setReview(v);
        },
        noValidate: true,
      },
      h(
        'section',
        null,
        h('h2', null, 'My information'),
        h(
          'div',
          { className: 'grid' },
          field('firstName', 'Legal first name', h('input', text('firstName'))),
          field('middleName', 'Middle name (optional)', h('input', text('middleName'))),
          field('lastName', 'Legal last name', h('input', text('lastName'))),
          field('email', 'Email address', h('input', text('email', 'email'))),
          field('phoneCountry', 'Country phone code', h('select', sel('phoneCountry'), opts(PHONE_CODES))),
          field('phone', 'Phone number', h('input', text('phone', 'tel'))),
          field('address1', 'Address line 1', h('input', text('address1')), true),
          field('city', 'City', h('input', text('city'))),
          field('state', 'State / Province', h('input', text('state'))),
          field('postal', 'Postal code', h('input', text('postal'))),
          field('country', 'Country', h('select', sel('country'), opts(COUNTRIES))),
        ),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Links'),
        h('div', { className: 'grid' }, field('linkedin', 'LinkedIn profile', h('input', text('linkedin', 'url'))), field('website', 'GitHub or portfolio URL', h('input', text('website', 'url')))),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Experience'),
        h(
          'div',
          { className: 'grid' },
          field('company', 'Current or most recent employer', h('input', text('company'))),
          field('title', 'Current job title', h('input', text('title'))),
          field('years', 'Total years of professional experience', h('input', text('years', 'number'))),
          field('notice', 'Notice period', h('select', sel('notice'), opts(['Immediate', '15 days', '30 days', '45 days', '60 days', '90 days']))),
          field('ctc', 'Current CTC (INR per annum)', h('input', text('ctc', 'number'))),
          field('ectc', 'Expected CTC (INR per annum)', h('input', text('ectc', 'number'))),
        ),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Education'),
        h(
          'div',
          { className: 'grid' },
          field('degree', 'Highest degree', h('select', sel('degree'), opts(["High school", 'Diploma', "Bachelor's degree", "Master's degree", 'Doctorate']))),
          field('school', 'University or college', h('input', text('school'))),
          field('gradYear', 'Graduation year', h('input', text('gradYear', 'number'))),
        ),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Application questions'),
        h('fieldset', null, h('legend', null, 'Are you legally authorized to work in India?'), radio('authorized', 'Yes'), radio('authorized', 'No')),
        h(
          'fieldset',
          null,
          h('legend', null, 'Will you now or in the future require sponsorship for an employment visa to work in India?'),
          radio('sponsorship', 'Yes'),
          radio('sponsorship', 'No'),
        ),
        h(
          'div',
          { className: 'grid' },
          field('source', 'How did you hear about this role?', h('select', sel('source'), opts(['LinkedIn', 'Employee referral', 'Company website', 'Job board', 'Other']))),
          field('why', 'Why do you want to work at Northwind?', h('textarea', text('why')), true),
        ),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Voluntary self-identification'),
        h('div', { className: 'grid' }, field('gender', 'Gender', h('select', sel('gender'), opts(['Female', 'Male', 'Non-binary', 'Prefer not to say'])))),
        h(
          'div',
          { className: 'check', style: { marginTop: '14px' } },
          h('label', null, h('input', { type: 'checkbox', name: 'certify', id: 'certify', checked: !!v.certify, onChange: (e) => set('certify', e.target.checked) }), ' I certify that the information in this application is true and complete.'),
        ),
      ),
      h('div', { className: 'actions' }, h('button', { type: 'submit', id: 'review' }, 'Review application')),
      review ? h('section', null, h('h2', null, 'What the app received (React state)'), h('pre', { id: 'react-state' }, JSON.stringify(review, null, 2))) : null,
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();
