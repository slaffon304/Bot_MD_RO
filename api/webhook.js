export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");
  return res.status(200).send("POST OK");
}
