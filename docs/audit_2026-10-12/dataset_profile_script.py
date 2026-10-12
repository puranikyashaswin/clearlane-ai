import sys, polars as pl, csv
p = sys.argv[1]
# raw line count via csv module (handles quoted newlines)
with open(p, newline='', encoding='utf-8', errors='replace') as f:
    r = csv.reader(f); hdr = next(r); n_csv = sum(1 for _ in r)
print("header:", hdr)
print("csv_module_data_rows:", n_csv)
df = pl.read_csv(p, ignore_errors=True)
print("polars_rows(ignore_errors):", len(df))
d2 = df.drop_nulls(subset=["latitude", "longitude"])
print("rows_with_lat_lng:", len(d2))
print("lat range", d2["latitude"].min(), d2["latitude"].max(), "lng range", d2["longitude"].min(), d2["longitude"].max())
dt = df["created_datetime"].cast(pl.Utf8)
print("created_datetime samples:", dt.head(3).to_list(), "suffixes:", dt.str.slice(19).value_counts().head(5).to_dicts())
pd_ = dt.str.slice(0,19).str.to_datetime("%Y-%m-%d %H:%M:%S", strict=False)
print("date range:", pd_.min(), pd_.max(), "unparsed:", pd_.null_count())
hr = pd_.dt.hour().value_counts().sort("created_datetime" if False else pd_.dt.hour().name)
print("hour histogram:", dict(zip(hr[:,0].to_list(), hr[:,1].to_list())))
for c in ["vehicle_type","violation_type","junction_name","police_station"]:
    if c in df.columns: print(c, "n_unique", df[c].n_unique(), "top", df[c].value_counts(sort=True).head(4).to_dicts())
