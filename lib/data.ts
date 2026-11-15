import { readFileSync } from "node:fs";
import path from "node:path";
import type { Customer, CustomerId, Schedule, Transaction } from "./contract";

// Sample data only. In a real build this module is the one place that would
// talk to the bank's data platform instead of reading files.

const dataDir = path.join(process.cwd(), "data");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(path.join(dataDir, file), "utf8")) as T;

let cache: { customers: Customer[]; schedules: Schedule[]; transactions: Transaction[] } | null = null;

function load() {
  if (cache) return cache;
  const lines = readFileSync(path.join(dataDir, "transactions.csv"), "utf8").trim().split("\n").slice(1);
  const transactions = lines.map((line): Transaction => {
    const [customerId, date, amount, merchant, category, essential] = line.split(",");
    return {
      customerId: customerId as CustomerId,
      date,
      amount: Number(amount),
      merchant,
      category,
      essential: essential === "yes",
    };
  });
  cache = {
    customers: readJson<Customer[]>("customers.json"),
    schedules: readJson<Schedule[]>("schedule.json"),
    transactions,
  };
  return cache;
}

export const allCustomers = (): Customer[] => load().customers;

export function getCustomer(id: CustomerId): Customer {
  const customer = load().customers.find((c) => c.id === id);
  if (!customer) throw new Error(`Unknown customer: ${id}`);
  return customer;
}

export function getSchedule(id: CustomerId): Schedule {
  const schedule = load().schedules.find((s) => s.customerId === id);
  if (!schedule) throw new Error(`No schedule for: ${id}`);
  return schedule;
}

export const getTransactions = (id: CustomerId): Transaction[] =>
  load().transactions.filter((t) => t.customerId === id);

export const isCustomerId = (value: unknown): value is CustomerId =>
  value === "tom" || value === "sarah" || value === "mia";
