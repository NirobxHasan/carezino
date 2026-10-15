/** The 64 districts of Bangladesh, offered as suggestions for a center's district. */
export const BD_DISTRICTS = [
  'Bagerhat',
  'Bandarban',
  'Barguna',
  'Barishal',
  'Bhola',
  'Bogura',
  'Brahmanbaria',
  'Chandpur',
  'Chapai Nawabganj',
  'Chattogram',
  'Chuadanga',
  'Cox’s Bazar',
  'Cumilla',
  'Dhaka',
  'Dinajpur',
  'Faridpur',
  'Feni',
  'Gaibandha',
  'Gazipur',
  'Gopalganj',
  'Habiganj',
  'Jamalpur',
  'Jashore',
  'Jhalokathi',
  'Jhenaidah',
  'Joypurhat',
  'Khagrachhari',
  'Khulna',
  'Kishoreganj',
  'Kurigram',
  'Kushtia',
  'Lakshmipur',
  'Lalmonirhat',
  'Madaripur',
  'Magura',
  'Manikganj',
  'Meherpur',
  'Moulvibazar',
  'Munshiganj',
  'Mymensingh',
  'Naogaon',
  'Narail',
  'Narayanganj',
  'Narsingdi',
  'Natore',
  'Netrokona',
  'Nilphamari',
  'Noakhali',
  'Pabna',
  'Panchagarh',
  'Patuakhali',
  'Pirojpur',
  'Rajbari',
  'Rajshahi',
  'Rangamati',
  'Rangpur',
  'Satkhira',
  'Shariatpur',
  'Sherpur',
  'Sirajganj',
  'Sunamganj',
  'Sylhet',
  'Tangail',
  'Thakurgaon',
];

export const CURRENCIES = [
  { value: 'BDT', label: 'BDT · Bangladeshi taka' },
  { value: 'INR', label: 'INR · Indian rupee' },
  { value: 'NPR', label: 'NPR · Nepalese rupee' },
  { value: 'PKR', label: 'PKR · Pakistani rupee' },
  { value: 'LKR', label: 'LKR · Sri Lankan rupee' },
  { value: 'MYR', label: 'MYR · Malaysian ringgit' },
  { value: 'SGD', label: 'SGD · Singapore dollar' },
  { value: 'AED', label: 'AED · UAE dirham' },
  { value: 'SAR', label: 'SAR · Saudi riyal' },
  { value: 'GBP', label: 'GBP · Pound sterling' },
  { value: 'EUR', label: 'EUR · Euro' },
  { value: 'USD', label: 'USD · US dollar' },
];

let zones: { value: string; label: string }[] | null = null;

/** IANA time zones supported by this browser. */
export function timezoneOptions() {
  zones ??= (
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Asia/Dhaka']
  ).map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
  return zones;
}

export const DEFAULT_CENTER_SETTINGS = {
  country: 'Bangladesh',
  timezone: 'Asia/Dhaka',
  currency: 'BDT',
};
