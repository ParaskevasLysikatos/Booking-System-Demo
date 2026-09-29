from django.core.management.base import BaseCommand, CommandError

from uploads import s3, seed


class Command(BaseCommand):
    help = (
        "Upload the demo seed photos (core/seed_photos/*.webp) to the S3 "
        "bucket under property-images/seed/ (TICKET-037). Photos already "
        "there with the same size are skipped, so it is safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force", action="store_true",
            help="Upload every photo, even ones already in the bucket.",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Only report what would be uploaded.",
        )
        parser.add_argument(
            "--source", default=None,
            help="Folder to upload from (default: core/seed_photos).",
        )

    def handle(self, *args, **options):
        if not s3.uploads_enabled():
            raise CommandError(
                "S3 uploads are off - set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, "
                "AWS_S3_BUCKET and AWS_S3_REGION (see the README's S3 setup)."
            )
        files = seed.seed_files(options["source"])
        if not files:
            raise CommandError(f"No seed photos found in {options['source'] or seed.seed_dir()}.")

        uploaded, skipped, failed = 0, 0, []
        for path in files:
            url = seed.seed_url(path.name)
            size = path.stat().st_size
            reason = "forced"
            if not options["force"]:
                try:
                    remote = seed.remote_size(url)
                except OSError as exc:
                    remote, reason = None, f"couldn't check ({exc}), uploading anyway"
                else:
                    if remote == size:
                        skipped += 1
                        self.stdout.write(f"  skip    {path.name} (already there)")
                        continue
                    reason = "new" if remote is None else f"changed ({remote} -> {size} bytes)"

            if options["dry_run"]:
                uploaded += 1
                self.stdout.write(f"  would upload {path.name} ({reason})")
                continue
            try:
                seed.upload(path)
            except Exception as exc:  # noqa: BLE001 - botocore/network errors
                failed.append(path.name)
                self.stderr.write(f"  FAILED  {path.name}: {exc}")
                continue
            uploaded += 1
            self.stdout.write(f"  upload  {path.name} ({reason}, {size // 1024} KB)")

        verb = "Would upload" if options["dry_run"] else "Uploaded"
        self.stdout.write(
            f"{verb} {uploaded}, skipped {skipped}, failed {len(failed)} "
            f"of {len(files)} seed photos -> {s3.public_url(seed.SEED_PREFIX)}"
        )
        if failed:
            raise CommandError(f"{len(failed)} upload(s) failed: {', '.join(failed)}")
