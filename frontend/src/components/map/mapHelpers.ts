export function buildStyleUrl(
  region: string,
  style: string,
  apiKey: string,
  traffic?: boolean,
): string {
  const url = `https://maps.geo.${region}.amazonaws.com/v2/styles/${style}/descriptor?key=${apiKey}`
  return traffic && style !== 'Satellite' ? `${url}&traffic=All` : url
}
