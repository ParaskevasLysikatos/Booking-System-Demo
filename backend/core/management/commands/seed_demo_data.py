import random
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from faker import Faker

from bookings.models import Booking
from core.demo_accounts import (
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_PASSWORD,
    DEMO_ADMIN_USERNAME,
    DEMO_GUEST_PASSWORD,
    demo_admin_users,
    demo_guest_email,
    demo_guest_users,
    legacy_demo_users,
)
from favorites.models import Favorite
from listings.geo import demo_point
from listings.models import Property, PropertyImage
from reviews.models import Review
from uploads import s3 as uploads_s3
from uploads import seed as seed_photos

# Greek-themed locations, since this demo is explicitly set in Greece rather
# than Faker's default en_US locale.
LOCATIONS = [
    "Thessaloniki, Greece",
    "Athens, Greece",
    "Chania, Greece",
    "Heraklion, Greece",
    "Rhodes, Greece",
    "Santorini, Greece",
    "Mykonos, Greece",
    "Nafplio, Greece",
    "Ioannina, Greece",
    "Kalamata, Greece",
    "Volos, Greece",
    "Corfu, Greece",
]

ADJECTIVES = [
    "Cozy", "Sunny", "Modern", "Charming", "Spacious", "Elegant",
    "Rustic", "Breezy", "Stylish", "Quiet", "Bright", "Seaside",
]

NOUNS = [
    "Studio", "Apartment", "Loft", "Villa", "Cottage", "Suite",
    "Retreat", "Penthouse", "House", "Room",
]

AMENITIES_POOL = [
    "wifi", "parking", "pool", "air_conditioning", "kitchen", "tv",
    "washer", "heating", "pets_allowed", "balcony", "sea_view",
    "elevator", "gym",
]

# Which seed photos (TICKET-037, backend/core/seed_photos/<group>-<nn>.webp)
# suit each property type: the cover comes from the first list (an exterior,
# terrace or the main room), the other photos one per group from the second
# list, in order - so a villa shows its pool first, then a sea view,
# bedroom, kitchen, bathroom.
PHOTO_GROUPS = {
    "Villa": (["villa"], ["bedroom", "view", "kitchen", "bathroom"]),
    "House": (["house"], ["bedroom", "kitchen", "view", "bathroom"]),
    "Cottage": (["cottage"], ["bedroom", "kitchen", "bathroom", "view"]),
    "Retreat": (["cottage", "villa"], ["bedroom", "view", "kitchen", "bathroom"]),
    "Penthouse": (["penthouse"], ["apartment", "view", "bedroom", "kitchen", "bathroom"]),
    "Apartment": (["apartment"], ["bedroom", "kitchen", "bathroom", "view"]),
    "Suite": (["apartment", "bedroom"], ["bedroom", "bathroom", "view", "kitchen"]),
    "Loft": (["loft"], ["bedroom", "kitchen", "bathroom", "apartment"]),
    "Studio": (["studio"], ["kitchen", "bathroom", "bedroom"]),
    "Room": (["bedroom", "studio"], ["bathroom", "view", "kitchen"]),
}

# Weighted rating distribution (skewed positive, like a real demo dataset).
RATING_WEIGHTS = {5: 45, 4: 30, 3: 15, 2: 7, 1: 3}

# About a quarter of guests only leave stars (TICKET-037).
NO_COMMENT_SHARE = 0.25

COMMENTS_BY_RATING = {
    5: [
        "Absolutely wonderful stay, would book again in a heartbeat!",
        "Exceeded every expectation - spotless, comfortable, and great location.",
        "Host was fantastic and the place looked exactly like the photos.",
        "The view alone is worth it. We had breakfast on the balcony every morning.",
        "Perfect base for exploring the town - everything within walking distance.",
        "Super clean, lovely little touches everywhere, and a very easy check-in.",
        "Quiet, bright and beautifully decorated. We didn't want to leave.",
        "Great beds, strong wifi and a fully equipped kitchen. Five stars.",
        "Our second time here and it was just as good as the first.",
    ],
    4: [
        "Really enjoyed our stay, just a couple of minor things could improve.",
        "Great value for the price, would recommend to friends.",
        "Comfortable and well located, minor noise from the street at night.",
        "Lovely place, the photos don't do it justice. Parking was a bit tricky.",
        "Very nice apartment, only the shower pressure could be better.",
        "Friendly host and good communication. A few more kitchen basics would help.",
        "Nice and cosy, a little warm at night but the fan helped.",
        "Good stay overall - clean, central and exactly as described.",
    ],
    3: [
        "It was fine - nothing special, but did the job for a short stay.",
        "Decent place, though a bit smaller than it looked in the pictures.",
        "Good location, but the furniture is showing its age.",
        "OK for one or two nights. The walls are thin.",
        "Clean enough, but check-in instructions could be clearer.",
        "Mixed feelings: great terrace, but the bedroom was quite dark.",
    ],
    2: [
        "Had some issues with cleanliness that weren't addressed quickly.",
        "Location was inconvenient and check-in was more complicated than expected.",
        "The air conditioning didn't work for most of our stay.",
        "Noisy at night and the beds were uncomfortable.",
    ],
    1: [
        "Would not stay here again, the listing didn't match the description.",
        "Very disappointing - dirty on arrival and the host didn't reply.",
        "Several amenities in the listing weren't actually there.",
    ],
}


class Command(BaseCommand):
    help = (
        "Populate the database with realistic demo data (properties, images, "
        "guest users, bookings, and reviews) using Faker, so the app doesn't "
        "start out empty. Safe to re-run; use --clear to wipe previously "
        "seeded demo data first."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help=(
                "Delete previously seeded demo data first (reviews, bookings, "
                "property images, properties, and the demo accounts - "
                "guest<N>@demo.com and admin@demo.com, plus the old-style "
                "guest_*@example.com / admin_demo ones; real accounts are "
                "never touched)."
            ),
        )
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help=(
                "Do nothing if any property already exists. Used by the Render "
                "build (build.sh) so only the very first deploy seeds, and later "
                "deploys never wipe or duplicate data."
            ),
        )
        parser.add_argument(
            "--replace-old-demo",
            action="store_true",
            help=(
                "If demo accounts from before TICKET-041 exist (admin_demo, "
                "guest_*@example.com), re-seed from scratch as if --clear "
                "was given - even with --if-empty. Otherwise it changes "
                "nothing. Used by the Render build (build.sh) for a one-off "
                "re-seed of the hosted copy: after that run no old-style "
                "accounts are left, so later deploys skip it by themselves."
            ),
        )
        parser.add_argument(
            "--properties",
            type=int,
            default=14,
            help="Number of properties to create (default: 14).",
        )
        parser.add_argument(
            "--guests",
            type=int,
            default=10,
            help="Number of guest users to create (default: 10).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Random seed, for reproducible output (default: not fixed).",
        )

    def handle(self, *args, **options):
        if options["replace_old_demo"] and legacy_demo_users().exists():
            self.stdout.write(
                "Old-style demo accounts found (admin_demo / guest_*@example.com) - "
                "re-seeding with the new demo logins (--replace-old-demo)."
            )
            options["clear"] = True
        elif options["if_empty"] and Property.objects.exists():
            self.stdout.write("Properties already exist - skipping the demo seed (--if-empty).")
            return

        if options["seed"] is not None:
            random.seed(options["seed"])
            Faker.seed(options["seed"])

        fake = Faker()

        with transaction.atomic():
            if options["clear"]:
                self._clear_demo_data()

            admin_status = self._create_admin()
            guests = self._create_guests(fake, options["guests"])
            properties = self._create_properties(fake, options["properties"])
            self._ensure_one_retired(properties)
            self._create_images(properties)
            self._create_bookings(properties, guests)
            to_review_live = self._create_unreviewed_stays(properties, guests)
            self._create_past_stays(properties, guests, to_review_live)
            self._create_reviews(fake, properties, to_review_live)
            favorites = self._create_favorites(properties, guests)

        reviews = Review.objects.filter(property__in=properties).count()
        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded {len(properties)} properties, {len(guests)} guests, "
            f"{reviews} reviews and {favorites} saved places (favorites)."
        ))
        self.stdout.write(f"Photos: {self.photo_source}")
        self.stdout.write(
            f"Demo admin login: {DEMO_ADMIN_EMAIL} / {DEMO_ADMIN_PASSWORD} "
            f"(app/API, by email) - or username {DEMO_ADMIN_USERNAME} for /admin/"
        )
        if admin_status == "existed":
            self.stdout.write("  (the demo admin already existed - left untouched)")
        elif admin_status == "username_taken":
            self.stdout.write(self.style.WARNING(
                f"  Not created: another account already uses the username "
                f"'{DEMO_ADMIN_USERNAME}'. Rename that account and re-run to get "
                f"the demo admin."
            ))
        if guests:
            self.stdout.write(
                f"Demo guest logins: {guests[0].email} ... {guests[-1].email} "
                f"/ {DEMO_GUEST_PASSWORD}"
            )

    # -- clearing -----------------------------------------------------

    def _clear_demo_data(self):
        """Delete order matters: Booking/Review use on_delete=PROTECT on
        `property`, so they must go before Property. Demo accounts are
        identified by the patterns in core/demo_accounts.py (the current
        guest<N>@demo.com / admin@demo.com and the old-style
        guest_*@example.com / admin_demo), so real accounts are never
        touched."""
        self.stdout.write("Clearing previously seeded demo data...")
        # Favorites would go with their properties/users anyway (CASCADE);
        # deleted first so the order reads like the rest.
        Favorite.objects.all().delete()
        Review.objects.all().delete()
        Booking.objects.all().delete()
        PropertyImage.objects.all().delete()
        Property.objects.all().delete()
        demo_guest_users().delete()
        demo_admin_users().delete()
        legacy_demo_users().delete()

    # -- admin ------------------------------------------------------------

    def _create_admin(self):
        """One fixed-credential superuser (admin@demo.com / admin123) for
        admin-only flows. Superuser/staff status makes the existing post_save
        signal (accounts/signals.py) set Profile.role='admin' automatically -
        the same path a real admin account goes through, so this exercises
        the actual rule rather than a seed-only shortcut.

        Returns "created", "existed" (re-running without --clear: left
        alone) or "username_taken" (a different account - e.g. the owner's
        own superuser - is already called "admin": never touched)."""
        if demo_admin_users().exists():
            return "existed"
        if User.objects.filter(username=DEMO_ADMIN_USERNAME).exists():
            return "username_taken"
        # create_superuser() also skips the password validators.
        User.objects.create_superuser(
            DEMO_ADMIN_USERNAME, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD
        )
        return "created"

    # -- guests ---------------------------------------------------------

    def _create_guests(self, fake, count):
        """guest1@demo.com ... guest<count>@demo.com, all with the shared
        DEMO_GUEST_PASSWORD (set_password() skips the password validators).
        The username is the email - the same rule sign-up uses. Faker only
        provides the names. A guest that already exists (re-running without
        --clear) is reused as is, so re-running never hits a duplicate."""
        guests = []
        for number in range(1, count + 1):
            email = demo_guest_email(number)
            user = User.objects.filter(username__iexact=email).first()
            if user is None:
                user = User(
                    username=email,
                    email=email,
                    first_name=fake.first_name(),
                    last_name=fake.last_name(),
                )
                user.set_password(DEMO_GUEST_PASSWORD)
                user.save()
            guests.append(user)
        return guests

    # -- properties -------------------------------------------------------

    def _create_properties(self, fake, count):
        properties = []
        for _ in range(count):
            location = random.choice(LOCATIONS)
            city = location.split(",")[0]
            noun = random.choice(NOUNS)
            title = f"{random.choice(ADJECTIVES)} {noun} in {city}"
            amenities = random.sample(
                AMENITIES_POOL, k=random.randint(3, len(AMENITIES_POOL))
            )
            # A map position near the city centre (TICKET-034).
            latitude, longitude = demo_point(location)
            prop = Property.objects.create(
                title=title,
                description=fake.paragraph(nb_sentences=5),
                location=location,
                latitude=latitude,
                longitude=longitude,
                price_per_night=Decimal(random.randint(25, 250)),
                capacity=random.randint(1, 8),
                amenities=amenities,
                is_active=random.random() < 0.9,
            )
            prop.seed_kind = noun  # picks its photos in _create_images
            properties.append(prop)
        return properties

    # -- images -----------------------------------------------------------

    def _create_images(self, properties):
        """3-5 photos per property. With S3 configured (the four AWS_*
        settings) they are the seed photos in the bucket, matched to the
        property type (PHOTO_GROUPS) - run `manage.py upload_seed_photos`
        once first. Without S3 (fresh clones, tests) they fall back to
        deterministic picsum.photos URLs, like before TICKET-037."""
        by_group = self._seed_photo_groups()
        if not by_group:
            self.photo_source = "picsum.photos (S3 off or no seed photos)"
            for prop in properties:
                for idx in range(random.randint(3, 5)):
                    PropertyImage.objects.create(
                        property=prop,
                        image=f"https://picsum.photos/seed/{prop.pk}-{idx}/800/600",
                        is_cover=(idx == 0),
                    )
            return

        self.photo_source = f"S3 seed photos ({uploads_s3.public_url(seed_photos.SEED_PREFIX)})"
        used = {}  # name -> times used so far, to spread the photos out

        def least_used(options):
            fewest = min(used.get(n, 0) for n in options)
            name = random.choice([n for n in options if used.get(n, 0) == fewest])
            used[name] = used.get(name, 0) + 1
            return name

        for prop in properties:
            cover_groups, extra_groups = PHOTO_GROUPS.get(
                getattr(prop, "seed_kind", ""), (["apartment"], ["bedroom", "kitchen", "bathroom"])
            )
            covers = [n for g in cover_groups for n in by_group.get(g, [])]
            if not covers:  # a trimmed folder: any photo will do
                covers = [n for names in by_group.values() for n in names]
            names = [least_used(covers)]
            for group in extra_groups[:random.randint(2, 4)]:
                options = [n for n in by_group.get(group, []) if n not in names]
                if options:
                    names.append(least_used(options))
            for idx, name in enumerate(names):
                PropertyImage.objects.create(
                    property=prop, image=seed_photos.seed_url(name), is_cover=(idx == 0),
                )

    def _seed_photo_groups(self):
        """{"villa": ["villa-01.webp", ...], ...} from the repo folder, or {}
        when S3 isn't configured (then the seeder uses picsum)."""
        if not uploads_s3.uploads_enabled():
            return {}
        groups = {}
        for path in seed_photos.seed_files():
            groups.setdefault(path.name.rsplit("-", 1)[0], []).append(path.name)
        return groups

    # -- bookings -----------------------------------------------------------

    def _create_bookings(self, properties, guests):
        today = timezone.localdate()
        for prop in properties:
            for _ in range(random.randint(0, 5)):
                start_offset = random.randint(-60, 300)
                check_in = today + timedelta(days=start_offset)
                check_out = check_in + timedelta(days=random.randint(1, 14))

                # Reuse the overlap-detection helper built for TICKET-008 so
                # seeded bookings never conflict for the same property.
                if Property.objects.filter(pk=prop.pk).exists() and Booking.objects.overlapping(
                    prop, check_in, check_out
                ).exists():
                    continue

                nights = (check_out - check_in).days
                total_price = prop.price_per_night * nights

                if check_out <= today:
                    # Past stay: mostly confirmed, a few cancelled.
                    status = random.choices(
                        [Booking.Status.CONFIRMED, Booking.Status.CANCELLED],
                        weights=[85, 15],
                    )[0]
                else:
                    # Upcoming stay: a mix of pending/confirmed/cancelled.
                    status = random.choices(
                        [Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.CANCELLED],
                        weights=[30, 55, 15],
                    )[0]

                Booking.objects.create(
                    property=prop,
                    guest=random.choice(guests),
                    check_in=check_in,
                    check_out=check_out,
                    guests=random.randint(1, prop.capacity),
                    total_price=total_price,
                    status=status,
                )

    # -- reviews -----------------------------------------------------------

    def _create_past_stays(self, properties, guests, skip):
        """TICKET-037: enough ended, confirmed stays that every property gets
        4-8 reviews (each backed by a real stay - the API's rule). Adds stays
        in the last 12 months for guests who haven't stayed there yet, until
        4-8 different guests have a confirmed, ended stay at the property.
        One guest can review a place only once, so with 10 demo guests a
        property tops out at 10 reviews."""
        today = timezone.localdate()
        for prop in properties:
            target = min(random.randint(4, 8), len(guests))
            stayed = set(Booking.objects.filter(
                property=prop, status=Booking.Status.CONFIRMED, check_out__lte=today,
            ).values_list("guest_id", flat=True)) - {g for (p, g) in skip if p == prop.pk}
            candidates = [g for g in guests if g.pk not in stayed and (prop.pk, g.pk) not in skip]
            random.shuffle(candidates)
            for guest in candidates:
                if len(stayed) >= target:
                    break
                if self._add_ended_stay(prop, guest, today, days_back=365):
                    stayed.add(guest.pk)

    def _add_ended_stay(self, prop, guest, today, days_back, attempts=25):
        """One confirmed 2-7 night stay for `guest` that ended between
        `days_back` days ago and yesterday, on free dates (the same
        overlapping() check the API uses). Booked 1-8 weeks before it
        started, so "booked on" dates look real. False if no free slot."""
        for _ in range(attempts):
            nights = random.randint(2, 7)
            check_out = today - timedelta(days=random.randint(1, days_back))
            check_in = check_out - timedelta(days=nights)
            if Booking.objects.overlapping(prop, check_in, check_out).exists():
                continue
            booking = Booking.objects.create(
                property=prop,
                guest=guest,
                check_in=check_in,
                check_out=check_out,
                guests=random.randint(1, prop.capacity),
                total_price=prop.price_per_night * nights,
                status=Booking.Status.CONFIRMED,
            )
            booked_on = timezone.now() - timedelta(
                days=(today - check_in).days + random.randint(7, 56), hours=random.randint(0, 12),
            )
            Booking.objects.filter(pk=booking.pk).update(created_at=booked_on)
            return booking
        return None

    def _create_reviews(self, fake, properties, skip=frozenset()):
        """One review per guest per property with a confirmed, ended stay -
        the same rule the API enforces (TICKET-032). Ratings skew positive
        with some 1-3 stars; about a quarter have no comment. Dated a few
        days after that guest's last stay there, so the months shown on the
        property page are believable."""
        today = timezone.localdate()
        past_bookings = Booking.objects.filter(
            property__in=properties,
            check_out__lte=today,
            status=Booking.Status.CONFIRMED,
        ).order_by("check_out")

        last_stay = {}  # (property, guest) -> latest check-out
        for booking in past_bookings:
            last_stay[(booking.property_id, booking.guest_id)] = booking.check_out

        now = timezone.now()
        for (property_id, guest_id), check_out in last_stay.items():
            if (property_id, guest_id) in skip:  # kept for a live demo review
                continue
            rating = random.choices(
                list(RATING_WEIGHTS.keys()), weights=list(RATING_WEIGHTS.values())
            )[0]
            comment = "" if random.random() < NO_COMMENT_SHARE else random.choice(COMMENTS_BY_RATING[rating])
            # get_or_create respects unique_review_per_guest_per_property (and
            # leaves a review from an earlier run alone).
            review, created = Review.objects.get_or_create(
                property_id=property_id,
                guest_id=guest_id,
                defaults={"rating": rating, "comment": comment},
            )
            if created:
                written = now - timedelta(
                    days=max((today - check_out).days - random.randint(0, 6), 0),
                    hours=random.randint(0, 20),
                )
                Review.objects.filter(pk=review.pk).update(created_at=min(written, now))

    def _create_unreviewed_stays(self, properties, guests):
        """So the review flow can be shown live: every demo guest gets one
        recent, ended stay (last 1-6 weeks) at an active place where they
        have no other ended stay, and it is left without a review -
        "Leave a review" in My bookings and "Write a review" on that property
        page. Runs before the reviewed stays; returns the (property id,
        guest id) pairs the reviews must skip."""
        today = timezone.localdate()
        active = [p for p in properties if p.is_active]
        pairs = set()
        for guest in guests:
            stayed = set(Booking.objects.filter(
                guest=guest, status=Booking.Status.CONFIRMED, check_out__lte=today,
            ).values_list("property_id", flat=True))
            options = [p for p in active if p.pk not in stayed]
            random.shuffle(options)
            for prop in options:
                if self._add_ended_stay(prop, guest, today, days_back=42):
                    pairs.add((prop.pk, guest.pk))
                    break
        return pairs

    # -- favorites (TICKET-033) ---------------------------------------------

    def _ensure_one_retired(self, properties):
        """The Saved page's "No longer available" card and the admin "Retired"
        filter need one retired place (TICKET-033). If the random mix retired
        none, the last one is retired - decided up front (TICKET-037) so the
        stays and reviews below already know which places are active."""
        if len(properties) > 1 and all(p.is_active for p in properties):
            last = properties[-1]
            last.is_active = False
            last.save(update_fields=["is_active", "updated_at"])

    def _create_favorites(self, properties, guests):
        """Each demo guest saves 2-5 active places, so the hearts, the Saved
        page and the admin "Saved by" column have something to show. The
        first guest also keeps one *retired* place saved - the Saved page's
        greyed-out "No longer available" card (_ensure_one_retired made
        sure there is one)."""
        if not properties or not guests:
            return 0
        retired = [p for p in properties if not p.is_active]
        active = [p for p in properties if p.is_active]

        count = 0
        for guest in guests:
            picks = random.sample(active, k=min(len(active), random.randint(2, 5)))
            for prop in picks:
                Favorite.objects.get_or_create(user=guest, property=prop)
                count += 1
        if retired:
            _, created = Favorite.objects.get_or_create(user=guests[0], property=retired[0])
            count += int(created)
        return count
